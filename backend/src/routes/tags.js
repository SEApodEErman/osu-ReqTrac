const express = require('express');
const { getDatabase } = require('../db');

const router = express.Router();

router.get('/', async (_req, res, next) => {
  try {
    const db = await getDatabase();
    res.json(await db.all(`
      SELECT t.id, t.name, COUNT(rt.request_id) AS usage_count
      FROM tags t
      LEFT JOIN request_tags rt ON rt.tag_id = t.id
      GROUP BY t.id, t.name
      ORDER BY usage_count DESC, t.name COLLATE NOCASE
    `));
  } catch (error) {
    next(error);
  }
});

module.exports = router;
