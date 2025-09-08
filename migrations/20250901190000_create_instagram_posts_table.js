/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.createTable("instagram_posts", function (table) {
    table.increments("id").primary();
    table.string("url").notNullable();
    table.string("post_id").notNullable().unique();
    table.string("username").notNullable();
    table.integer("likes").defaultTo(0);
    table.integer("comments").defaultTo(0);
    table.text("caption").nullable().comment("Legenda do post do Instagram");
    table.text("videoAnalysis").nullable().comment("Análise do vídeo do Instagram");
    table.text("generatedComment").nullable().comment("Comentário gerado pela IA");
    table.datetime("post_date").nullable();
    table.timestamps(true, true);
    table
      .json("liked_by_users")
      .nullable()
      .comment("Array de usernames que curtiram o post");
    table
      .boolean("followed_likers")
      .defaultTo(false)
      .comment("Se já seguiu os curtidores deste post");
    // Índices para melhor performance
    table.index(["username"]);
    table.index(["post_date"]);
    table.index(["created_at"]);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.dropTable("instagram_posts");
};
