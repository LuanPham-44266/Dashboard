(function () {
  const TOKEN_KEY = 'authToken';
  const USER_KEY = 'authUser';

  function getToken() {
    return localStorage.getItem(TOKEN_KEY) || '';
  }

  function getUser() {
    try {
      const raw = localStorage.getItem(USER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      console.error('Invalid authUser in localStorage', error);
      return null;
    }
  }

  function getRole() {
    const user = getUser();
    return String((user && user.role) || 'Manager').trim();
  }

  function isAuthenticated() {
    return Boolean(getToken()) && Boolean(getUser());
  }

  function requireAuth() {
    if (!isAuthenticated()) {
      window.location.href = '/login.html';
      return false;
    }
    return true;
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    window.location.href = '/login.html';
  }

  function hydrateUserText() {
    const userText = document.getElementById('currentUserText');
    if (!userText) return;

    const user = getUser();
    const name = user?.full_name || user?.name || user?.email || 'User';
    const role = getRole();
    userText.textContent = `${name} • ${role}`;
  }

  window.Auth = {
    TOKEN_KEY,
    USER_KEY,
    getToken,
    getUser,
    getRole,
    isAuthenticated,
    requireAuth,
    logout,
    hydrateUserText,
  };
})();
