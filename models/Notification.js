const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const Notification = sequelize.define('Notification', {
    notification_id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    recipient_id: { type: DataTypes.INTEGER, allowNull: false },
    message: { type: DataTypes.TEXT, allowNull: false },
    timestamp: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    read_status: { type: DataTypes.ENUM('Unread', 'Read'), defaultValue: 'Unread' }
}, { tableName: 'notifications' });

module.exports = Notification;
