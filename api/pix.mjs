import handler from '../checkout-api.mjs';
export default function pix(req, res) { req.url = '/api/pix'; return handler(req, res); }
