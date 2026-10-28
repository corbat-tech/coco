import { findUser } from "./users.mjs";
export function greeting(users, id) {
  const result = findUser(users, id);
  return result.found ? `Hello ${result.item.name}` : "Unknown user";
}
