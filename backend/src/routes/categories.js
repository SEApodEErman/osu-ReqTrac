const express = require('express');
const { getDatabase } = require('../db');
const { cleanCatalogName, VALID_CATEGORY_VIEW_TYPES } = require('../utils/catalog');

const router = express.Router();
const RESERVED_NAMES = new Set(['all requests', 'dashboard', 'settings']);

router.get('/', async (req, res, next) => {
  try {
    const db = await getDatabase();
    const includeArchived = req.query.includeArchived === '1';
    const categories = await db.all(`
      SELECT c.*,
        (SELECT COUNT(*) FROM request_categories rc WHERE rc.category_id = c.id) AS request_count
      FROM categories c
      ${includeArchived ? '' : 'WHERE c.is_active = 1'}
      ORDER BY c.sort_order, c.id
    `);
    res.json(categories);
  } catch (error) {
    next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const name = cleanCatalogName(req.body.name, 'Category name');
    if (RESERVED_NAMES.has(name.toLowerCase())) {
      return res.status(400).json({ error: 'That category name is reserved.' });
    }
    const viewType = VALID_CATEGORY_VIEW_TYPES.has(req.body.view_type) ? req.body.view_type : 'tagged';
    const db = await getDatabase();
    const existing = await db.get('SELECT id FROM categories WHERE name = ? COLLATE NOCASE', name);
    if (existing) return res.status(409).json({ error: 'A category with that name already exists.' });
    const order = await db.get('SELECT COALESCE(MAX(sort_order), -1) + 1 AS value FROM categories');
    const result = await db.run(
      'INSERT INTO categories (name, view_type, sort_order) VALUES (?, ?, ?)',
      name, viewType, order.value
    );
    res.status(201).json(await db.get('SELECT * FROM categories WHERE id = ?', result.lastID));
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT') return res.status(409).json({ error: 'A category with that name already exists.' });
    next(error);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const db = await getDatabase();
    const category = await db.get('SELECT * FROM categories WHERE id = ?', id);
    if (!category) return res.status(404).json({ error: 'Category not found.' });

    const name = req.body.name === undefined ? category.name : cleanCatalogName(req.body.name, 'Category name');
    if (RESERVED_NAMES.has(name.toLowerCase())) return res.status(400).json({ error: 'That category name is reserved.' });
    const isActive = req.body.is_active === undefined ? category.is_active : Number(Boolean(req.body.is_active));
    if (category.system_key && !isActive) return res.status(400).json({ error: 'Built-in categories cannot be archived.' });
    const sortOrder = Number.isSafeInteger(Number(req.body.sort_order)) ? Number(req.body.sort_order) : category.sort_order;
    const viewType = category.system_key
      ? category.view_type
      : (VALID_CATEGORY_VIEW_TYPES.has(req.body.view_type) ? req.body.view_type : category.view_type);

    await db.exec('BEGIN TRANSACTION');
    try {
      await db.run(`
        UPDATE categories SET name = ?, view_type = ?, sort_order = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, name, viewType, sortOrder, isActive, id);
      // Transitional mirror for v1 integrations and older backups.
      await db.run('UPDATE request_categories SET category_name = ? WHERE category_id = ?', name, id);
      await db.exec('COMMIT');
    } catch (error) {
      await db.exec('ROLLBACK');
      throw error;
    }
    res.json(await db.get('SELECT * FROM categories WHERE id = ?', id));
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT') return res.status(409).json({ error: 'A category with that name already exists.' });
    next(error);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const db = await getDatabase();
    const category = await db.get('SELECT * FROM categories WHERE id = ?', id);
    if (!category) return res.status(404).json({ error: 'Category not found.' });
    if (category.system_key) return res.status(400).json({ error: 'Built-in categories cannot be deleted.' });
    const usage = await db.get('SELECT COUNT(*) AS count FROM request_categories WHERE category_id = ?', id);
    if (usage.count > 0) {
      await db.run('UPDATE categories SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?', id);
      return res.json({ success: true, archived: true, request_count: usage.count });
    }
    await db.run('DELETE FROM categories WHERE id = ?', id);
    res.json({ success: true, deleted: true });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
