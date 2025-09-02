/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.createTable('chat_states', function(table) {
    table.increments('id').primary();
    table.string('chat_id').notNullable().unique(); // ID do chat
    table.text('last_message_snapshot').nullable(); // Snapshot das últimas mensagens para comparação
    table.timestamp('last_check').defaultTo(knex.fn.now());
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    
    table.index('chat_id');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.dropTable('chat_states');
};