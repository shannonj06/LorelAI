import { timestamp } from '../db/index.js';

const toChat = (row) => ({
  id: row.id,
  title: row.title,
  messageCount: row.message_count ?? undefined,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toMessage = (row) => ({
  id: row.id,
  role: row.role,
  content: row.content,
  response: row.response === null ? null : JSON.parse(row.response),
  createdAt: row.created_at,
});

export async function listForUser(db, userId) {
  const rows = await db.all(
    `SELECT c.id, c.title, c.created_at, c.updated_at,
            (SELECT COUNT(*) FROM chat_messages m WHERE m.chat_id = c.id) AS message_count
     FROM chats c WHERE c.user_id = ? ORDER BY c.updated_at DESC, c.id DESC`,
    [userId],
  );
  return rows.map(toChat);
}

export async function countForUser(db, userId) {
  const row = await db.get('SELECT COUNT(*) AS n FROM chats WHERE user_id = ?', [userId]);
  return row.n;
}

export async function findForUser(db, userId, chatId) {
  const row = await db.get('SELECT id, title, created_at, updated_at FROM chats WHERE id = ? AND user_id = ?', [
    chatId,
    userId,
  ]);
  return row && toChat(row);
}

export async function messages(db, chatId) {
  const rows = await db.all(
    'SELECT id, role, content, response, created_at FROM chat_messages WHERE chat_id = ? ORDER BY id',
    [chatId],
  );
  return rows.map(toMessage);
}

/** Create a saved chat, optionally with the messages from the unsaved conversation so far. */
export async function create(db, { userId, title, messages: initial = [] }) {
  return db.transaction(async (tx) => {
    const now = timestamp();
    const { lastInsertId } = await tx.run(
      'INSERT INTO chats (user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?)',
      [userId, title, now, now],
    );
    for (const message of initial) await addMessage(tx, lastInsertId, message, { touch: false });
    return findForUser(tx, userId, lastInsertId);
  });
}

export async function addMessage(db, chatId, { role, content, response = null }, { touch = true } = {}) {
  const now = timestamp();
  const { lastInsertId } = await db.run(
    'INSERT INTO chat_messages (chat_id, role, content, response, created_at) VALUES (?, ?, ?, ?, ?)',
    [chatId, role, content, response === null ? null : JSON.stringify(response), now],
  );
  if (touch) await db.run('UPDATE chats SET updated_at = ? WHERE id = ?', [now, chatId]);
  return lastInsertId;
}

export async function rename(db, userId, chatId, title) {
  const { changes } = await db.run('UPDATE chats SET title = ?, updated_at = ? WHERE id = ? AND user_id = ?', [
    title,
    timestamp(),
    chatId,
    userId,
  ]);
  return changes > 0;
}

export async function remove(db, userId, chatId) {
  const { changes } = await db.run('DELETE FROM chats WHERE id = ? AND user_id = ?', [chatId, userId]);
  return changes > 0;
}

export async function countAll(db) {
  const row = await db.get(
    'SELECT (SELECT COUNT(*) FROM chats) AS chats, (SELECT COUNT(*) FROM chat_messages) AS messages',
  );
  return { chats: row.chats, messages: row.messages };
}
