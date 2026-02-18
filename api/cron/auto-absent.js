// api/cron/auto-absent.js
// Vercel Cron route: handles daily auto-absent marking
// Imported from the main cron.js handler

import handler from '../cron.js';

export default async function (req, res) {
    // Force the action to auto-absent regardless of query
    req.query = req.query || {};
    req.query.action = 'auto-absent';
    return handler(req, res);
}
