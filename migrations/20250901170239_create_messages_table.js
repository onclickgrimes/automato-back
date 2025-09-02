/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.createTable('messages', function(table) {
    table.increments('id').primary();
    table.string('chat_id').notNullable(); // referência ao chat
    table.text('text').notNullable(); // conteúdo da mensagem
    table.string('user_id').notNullable(); // referência ao usuário
    table.boolean('from_me').notNullable(); // se é minha mensagem ou do usuário
    table.boolean('answered').notNullable().defaultTo(false); // se foi respondida
    table.timestamp('timestamp').defaultTo(knex.fn.now());
    table.timestamp('created_at').defaultTo(knex.fn.now());
    
    // Foreign key constraints
    table.foreign('chat_id').references('id').inTable('chats').onDelete('CASCADE');
    table.foreign('user_id').references('id').inTable('users').onDelete('CASCADE');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.dropTable('messages');
};
