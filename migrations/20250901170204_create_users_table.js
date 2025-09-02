/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.createTable('users', function(table) {
    table.string('id').primary(); // username como id
    table.string('avatar').nullable(); // profileImageUrl
    table.string('username').notNullable(); // username obrigatório
    table.string('name').nullable();
    table.string('email').nullable();
    table.string('telefone').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.dropTable('users');
};
