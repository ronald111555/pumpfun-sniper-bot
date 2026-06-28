import { Sequelize, DataTypes } from "@sequelize/core";
import { PostgresDialect } from "@sequelize/postgres";
// import configs from "../../database/config/config.cjs";
import { CatchedPoint } from "../../database/models/catchedPoint.js";

import {
  PG_HOST,
  PG_DB,
  PG_USERNAME,
  PG_PORT,
  PG_PASSWORD,
} from "../constants/constants.js";

const sequelize = new Sequelize({
  dialect: PostgresDialect,
  database: PG_DB,
  user: PG_USERNAME,
  password: PG_PASSWORD,
  host: PG_HOST,
  port: PG_PORT,
});

const catchedPoint = CatchedPoint(sequelize, DataTypes);

export const insertCatchedOrder = async ({
  slug,
  up_price,
  down_price,
  catch_time,
  beat_price,
  first_buy_token_side,
}) => {
  const existing = await catchedPoint.findOne({
    where: { slug },
  });
  if (existing) {
    return;
  }

  await catchedPoint.create({
    slug: slug,
    up_price: up_price ?? null,
    down_price: down_price ?? null,
    beat_price,
    first_buy_token_side,
    catch_time: catch_time ?? new Date(),
  });
};

export const updateCatchedOrder = async ({
  slug,
  up_price,
  down_price,
  second_buy_token_side,
  second_buy_token_time,
}) => {
  const updateData = {};

  const existing = await catchedPoint.findOne({
    where: { slug },
  });

  if (!existing) return;
  if (existing.up_price && existing.down_price) {
    return;
  }

  if (up_price) updateData.up_price = up_price;
  if (down_price) updateData.down_price = down_price;
  await catchedPoint.update(
    {
      ...updateData,
      second_buy_token_side,
      second_buy_token_time,
    },
    {
      where: { slug: slug },
    },
  );
};

export const updateResult = async ({ slug, result }) => {
  const existing = await catchedPoint.findOne({
    where: { slug },
  });
  if (!existing) return;
  await catchedPoint.update({ result }, { where: { slug } });
};
