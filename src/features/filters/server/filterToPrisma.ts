import { type FilterState } from "@/src/features/filters/types";
import { type ColumnDefinition } from "@/src/server/api/interfaces/tableDefinition";
import { Prisma } from "@prisma/client";

const operatorReplacements = {
  "any of": "IN",
  "none of": "NOT IN",
};

export function filterToPrismaSql(
  filters: FilterState,
  tableColumns: ColumnDefinition[],
): Prisma.Sql {
  const statements = filters.map((filter) => {
    // Get column definition to map column to internal name, e.g. "t.id"
    const col = tableColumns.find((c) => c.name === filter.column);
    if (!col) {
      console.error("Invalid filter column", filter.column);
      throw new Error("Invalid filter column: " + filter.column);
    }

    const colPrisma = Prisma.raw(col.internal);
    const operatorPrisma =
      filter.operator in operatorReplacements
        ? Prisma.raw(
            operatorReplacements[
              filter.operator as keyof typeof operatorReplacements
            ],
          )
        : Prisma.raw(filter.operator); //checked by zod

    // Get prisma value
    let valuePrisma: Prisma.Sql;
    switch (filter.type) {
      case "datetime":
        valuePrisma = Prisma.sql`${
          filter.value
            .toISOString()
            .split(".")[0]! // remove milliseconds
            .replace("T", " ") // to Postgres datetime
        }::TIMESTAMP`;
        break;
      case "number":
      case "numberObject":
        valuePrisma = Prisma.sql`${filter.value}::DOUBLE PRECISION`;
        break;
      case "string":
      case "stringObject":
        valuePrisma = Prisma.sql`${filter.value}`;
        break;
      case "stringOptions":
        valuePrisma = Prisma.sql`(${Prisma.join(
          filter.value.map((v) => Prisma.sql`${v}`),
        )})`;
        break;
    }
    const jsonKeyPrisma =
      filter.type === "stringObject" || filter.type === "numberObject"
        ? Prisma.sql`->>${filter.key}`
        : Prisma.empty;
    const [cast1, cast2] =
      filter.type === "numberObject"
        ? [Prisma.raw("cast("), Prisma.raw(" as double precision)")]
        : [Prisma.empty, Prisma.empty];

    return Prisma.sql`${cast1}${colPrisma}${jsonKeyPrisma}${cast2} ${operatorPrisma} ${valuePrisma}`;
  });
  if (statements.length === 0) {
    return Prisma.empty;
  }

  return Prisma.join(
    [Prisma.raw("AND "), Prisma.join(statements, " AND ")],
    "",
  );
}