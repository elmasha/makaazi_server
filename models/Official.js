const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const Official = sequelize.define('Official', {
    official_id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    estate_id: { type: DataTypes.INTEGER, allowNull: false },
    full_name: { type: DataTypes.STRING, allowNull: false },
    role: { type: DataTypes.STRING, allowNull: false },
    contact_number: { type: DataTypes.STRING }
}, { tableName: 'officials' });

module.exports = Official;
