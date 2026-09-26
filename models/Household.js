const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const Household = sequelize.define('Household', {
    household_id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    estate_id: { type: DataTypes.INTEGER, allowNull: false },
    primary_owner: { type: DataTypes.STRING, allowNull: false },
    residence_status: { type: DataTypes.ENUM('Resident', 'Non-resident', 'Developing'), allowNull: false },
    contact_number: { type: DataTypes.STRING, allowNull: false }
}, { tableName: 'households' });

module.exports = Household;
