/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.createTable('chats', function(table) {
    table.string('id').primary(); // id do chat
    table.string('user_id').notNullable(); // referência à tabela users
    table.boolean('reply').defaultTo(true); // se o usuário deve ser respondido
    table.timestamp('created_at').defaultTo(knex.fn.now());
    
    // Foreign key constraint
    table.foreign('user_id').references('id').inTable('users').onDelete('CASCADE');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.dropTable('chats');
};
