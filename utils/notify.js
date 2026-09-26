const db = require("../config/db");

exports.sendNotification = ({
  user_uid,
  user_type,
  title,
  message,
  type = "SYSTEM",
}) => {
  return new Promise((resolve, reject) => {
    db.query(
      `
      INSERT INTO notifications
      (user_uid, user_type, title, message, type)
      VALUES (?, ?, ?, ?, ?)
      `,
      [user_uid, user_type, title, message, type],
      (err) => (err ? reject(err) : resolve())
    );
  });
};
