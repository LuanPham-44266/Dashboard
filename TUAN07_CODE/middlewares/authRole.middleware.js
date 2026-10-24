function authRole(allowedRoles = []) {
  return (req, res, next) => {
    const userRole = req && req.user && req.user.role ? String(req.user.role).trim() : '';

    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({
        success: false,
        message: `Forbidden: user role '${userRole || 'Unknown'}' is not allowed for this action.`,
      });
    }

    return next();
  };
}

module.exports = authRole;
