/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.alterTable('instagram_posts', function(table) {
    table.json('liked_by_users').nullable().comment('Array de usernames que curtiram o post');
    table.boolean('followed_likers').defaultTo(false).comment('Se já seguiu os curtidores deste post');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.alterTable('instagram_posts', function(table) {
    table.dropColumn('liked_by_users');
    table.dropColumn('followed_likers');
  });
};