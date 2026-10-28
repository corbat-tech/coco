export function findUser(users, id) {
  const item = users.find((user) => user.id === id);
  return item ? { found: true, item } : { found: false, item: null };
}
