import handler from '../checkout-api.mjs';
export default function status(req, res) { req.url = '/api/status'; return handler(req, res); }
