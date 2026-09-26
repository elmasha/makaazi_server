const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const ServiceCharge = sequelize.define('ServiceCharge', {
    charge_id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    charge_type: { type: DataTypes.STRING, allowNull: false },
    frequency: { type: DataTypes.ENUM('Monthly', 'Quarterly', 'Half-yearly', 'Annual', 'Adhoc'), allowNull: false },
    amount: { type: DataTypes.DECIMAL(10, 2), allowNull: false }
}, { tableName: 'service_charges' });

module.exports = ServiceCharge;
