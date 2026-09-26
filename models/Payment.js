const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const Payment = sequelize.define('Payment', {
    payment_id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    household_id: { type: DataTypes.INTEGER, allowNull: false },
    amount_paid: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    payment_method: { type: DataTypes.ENUM('Mpesa', 'Cash', 'Card'), allowNull: false },
    transaction_id: { type: DataTypes.STRING },
    payment_status: { type: DataTypes.ENUM('Pending', 'Completed'), defaultValue: 'Completed' }
}, { tableName: 'payments' });

module.exports = Payment;
