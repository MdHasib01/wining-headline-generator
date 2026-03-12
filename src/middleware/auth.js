const supabaseAdmin = require("../lib/supabase-admin");

async function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({
      error: "Unauthorized",
      message: "Missing bearer token",
    });
  }

  try {
    const { data, error } = await supabaseAdmin.auth.getUser(token);

    if (error || !data || !data.user) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "Invalid token",
      });
    }

    req.user = {
      id: data.user.id,
      email: data.user.email,
      raw: data.user,
    };

    return next();
  } catch (err) {
    console.error("Auth error:", err);

    return res.status(401).json({
      error: "Unauthorized",
      message: "Failed to authenticate",
    });
  }
}

module.exports = auth;
