const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const Visitor = sequelize.define('Visitor', {
    visitor_id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING, allowNull: false },
    contact_number: { type: DataTypes.STRING },
    purpose: { type: DataTypes.STRING },
    status: { type: DataTypes.ENUM('Pending', 'Approved', 'Denied'), defaultValue: 'Pending' }
}, { tableName: 'visitors' });

module.exports = Visitor;
