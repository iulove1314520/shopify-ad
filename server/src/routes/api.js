const express = require('express');

const { requireApiAuth } = require('../utils/auth');
const { handleVisitor, listVisitors } = require('../modules/visitor');
const { listMatches, listCallbacks } = require('../modules/match');

const router = express.Router();

router.post('/visitor', handleVisitor);
router.get('/visitors', requireApiAuth, listVisitors);
router.get('/matches', requireApiAuth, listMatches);
router.get('/callbacks', requireApiAuth, listCallbacks);

module.exports = router;

