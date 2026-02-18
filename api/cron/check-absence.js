// api/cron/check-absence.js
// Vercel Cron route: handles monthly absence check & demotion alerts
// Imported from the main cron.js handler

import handler from '../cron.js';

export default async function (req, res) {
    req.query = req.query || {};
    req.query.action = 'check-absence';
    return handler(req, res);
}
