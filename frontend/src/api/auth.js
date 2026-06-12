// Shared-token storage for the dashboard. The token is entered once on the
// login gate and kept in localStorage so it survives reloads on this laptop.

const KEY = 'fleet_token';

export const getToken = () => {
  try {
    return localStorage.getItem(KEY) || '';
  } catch {
    return '';
  }
};

export const setToken = (t) => {
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* private mode / storage disabled */
  }
};

export const clearToken = () => {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
};
