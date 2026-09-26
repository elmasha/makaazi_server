const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const Role = sequelize.define('Role', {
    role_id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    role_name: { type: DataTypes.STRING, allowNull: false },
    permissions: { type: DataTypes.TEXT, allowNull: false }
}, { tableName: 'roles' });

module.exports = Role;
