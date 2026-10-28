import { findUser } from "./users.mjs";
export function greeting(users, id) {
  const user = findUser(users, id);
  return user ? `Hello ${user.name}` : "Unknown user";
}
