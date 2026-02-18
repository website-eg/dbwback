// api/cron/check-promotion.js
// Vercel Cron route: handles monthly reserve → main promotion check
// Runs on the 1st of every month

import handler from '../cron.js';

export default async function (req, res) {
    req.query = req.query || {};
    req.query.action = 'check-promotion';
    return handler(req, res);
}
