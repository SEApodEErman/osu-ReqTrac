const express = require('express');
const router = express.Router();
const { getApiStatus } = require('../osuApi');

router.get('/status', (req, res) => {
  res.json(getApiStatus());
});

module.exports = router;
