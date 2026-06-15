// BulkMind v14 Vercel serverless retailer token placeholder
// Put Salling/retailer token in Vercel Environment Variables as SALLING_API_TOKEN.
// This endpoint only confirms token configuration right now; product-specific endpoints can be added once you know which official API route you want.

export default async function handler(req, res) {
  const token = process.env.SALLING_API_TOKEN;
  if (!token) return res.status(500).json({ configured: false, error: 'Missing SALLING_API_TOKEN in Vercel Environment Variables' });
  return res.status(200).json({ configured: true, message: 'Retailer token is configured server-side. It is not exposed to the browser.' });
}
