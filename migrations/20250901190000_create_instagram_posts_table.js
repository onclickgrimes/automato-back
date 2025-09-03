/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.createTable('instagram_posts', function(table) {
    table.increments('id').primary();
    table.string('url').notNullable();
    table.string('post_id').notNullable().unique();
    table.string('username').notNullable();
    table.integer('likes').defaultTo(0);
    table.integer('comments').defaultTo(0);
    table.datetime('post_date').nullable();
    table.timestamps(true, true);
    
    // Índices para melhor performance
    table.index(['username']);
    table.index(['post_date']);
    table.index(['created_at']);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.dropTable('instagram_posts');
};