// Effect Schema Class API integration for SurrealDB types
import { Schema } from "effect";
import type { TableDefinition } from "./schema.ts";

// Brand for RecordId type
type RecordId<T extends string = string> = string & {
  readonly RecordId: unique symbol;
  readonly Table: T;
};

/**
 * Create a RecordId schema for a specific table
 */
function recordId<T extends string>(tableName: T): Schema.Schema<RecordId<T>> {
  return Schema.String.pipe(
    Schema.pattern(/^[a-zA-Z0-9_-]+:[a-zA-Z0-9_-]+$/),
    Schema.brand(`RecordId<${tableName}>`),
  ) as unknown as Schema.Schema<RecordId<T>>;
}

/**
 * Format a table name as a class name
 */
function formatClassName(tableName: string): string {
  return tableName.charAt(0).toUpperCase() + tableName.slice(1);
}

/**
 * Generate Effect Schema classes from SurrealDB table definitions
 */
export function generateEffectSchemas(tables: TableDefinition[]): string {
  // Prepare imports
  const imports = `import { Schema } from "effect";

// Type for representing a RecordId in Effect Schema
type RecordId<T extends string = string> = string & {
  readonly RecordId: unique symbol;
  readonly Table: T;
};

/**
 * Create a RecordId schema for a specific table
 */
function recordId<T extends string>(tableName: T): Schema.Schema<RecordId<T>> {
  return Schema.String.pipe(
    Schema.pattern(/^[a-zA-Z0-9_-]+:[a-zA-Z0-9_-]+$/),
    Schema.brand(\`RecordId<\${tableName}>\`),
  ) as unknown as Schema.Schema<RecordId<T>>;
}
`;

  // Generate table classes
  const tableClasses = tables.map((table) => {
    const { name, fields, description } = table;
    const className = formatClassName(name);
    const needsRecursive = name === "telegram_message";

    // Check if table already has an 'id' field
    const hasIdField = fields.some(field => field.name === 'id');

    // Create a list of field definitions
    let fieldDefinitions = [];

    // Add default 'id' field if not explicitly defined
    if (!hasIdField) {
      fieldDefinitions.push(`  id: recordId("${name}").annotations({
    description: "Unique identifier"
  })`);
    }

    // Add all other field definitions
    fieldDefinitions = fieldDefinitions.concat(fields.map(field => {
      let effectType: string;
      const annotations: string[] = [];

      // Add description if available
      if (field.description) {
        const escapedDescription = field.description
          .replace(/\\'/g, "'")
          .replace(/'/g, "\\'");
        annotations.push(`description: '${escapedDescription}'`);
      }

      // Add default value if available
      if (field.defaultValue) {
        let formattedDefaultValue = field.defaultValue;

        // Handle SurrealDB function calls (like time::now())
        if (formattedDefaultValue.includes('::')) {
          // For datetime fields with SurrealDB functions, we'll add it as a separate annotation
          if (field.type.toLowerCase() === 'datetime') {
            annotations.push(`surrealDefault: '${formattedDefaultValue}'`);
          } else {
            formattedDefaultValue = `'${formattedDefaultValue}'`;
            annotations.push(`default: ${formattedDefaultValue}`);
          }
        } else {
          // If it's a simple string with quotes, keep as is
          // If it's a boolean or number, keep as is
          // If it's a string that's not already quoted, add quotes
          if (!formattedDefaultValue.startsWith("'") &&
            !formattedDefaultValue.startsWith('"') &&
            formattedDefaultValue !== 'true' &&
            formattedDefaultValue !== 'false' &&
            !/^-?\d+(\.\d+)?$/.test(formattedDefaultValue) &&
            !formattedDefaultValue.startsWith('[') &&
            !formattedDefaultValue.startsWith('{')) {
            formattedDefaultValue = `'${formattedDefaultValue}'`;
          }

          annotations.push(`default: ${formattedDefaultValue}`);
        }
      }

      // Build annotations string
      const annotationsStr = annotations.length > 0 ? `.annotations({ ${annotations.join(', ')} })` : '';

      switch (field.type.toLowerCase()) {
        case "int":
        case "number":
          effectType = `Schema.Number.pipe(Schema.int())${annotationsStr}`;
          break;
        case "float":
          effectType = `Schema.Number${annotationsStr}`;
          break;
        case "bool":
          effectType = `Schema.Boolean${annotationsStr}`;
          break;
        case "datetime":
          effectType = `Schema.Date${annotationsStr}`;
          break;
        case "array":
          effectType = `Schema.Array(Schema.String)${annotationsStr}`;
          break;
        case "array_float":
          effectType = `Schema.Array(Schema.Number)${annotationsStr}`;
          break;
        case "array_record":
          if (field.reference) {
            effectType = `Schema.Array(recordId("${field.reference.table}"))${annotationsStr}`;
          } else {
            effectType = `Schema.Array(Schema.String.pipe(Schema.pattern(/^[a-zA-Z0-9_-]+:[a-zA-Z0-9_-]+$/)))${annotationsStr}`;
          }
          break;
        case "object":
          effectType = `Schema.Record(Schema.String, Schema.Unknown)${annotationsStr}`;
          break;
        case "record":
          if (field.reference) {
            // For self-referential fields, we need to handle the record ID format
            if (field.name === "reply_to_message_id" && field.reference.table === "telegram_message") {
              effectType = `recordId("telegram_message")${annotationsStr}`;
            } else {
              effectType = `recordId("${field.reference.table}")${annotationsStr}`;
            }
          } else {
            effectType = `Schema.String.pipe(Schema.pattern(/^[a-zA-Z0-9_-]+:⟨\\d+⟩$/))${annotationsStr}`;
          }
          break;
        case "references":
          if (field.reference) {
            effectType = `Schema.Array(recordId("${field.reference.table}"))${annotationsStr}`;
          } else {
            effectType = `Schema.Array(Schema.String)${annotationsStr}`;
          }
          break;
        default:
          effectType = `Schema.String${annotationsStr}`;
          break;
      }

      // Make optional if needed
      if (field.type.toLowerCase() !== "datetime" && field.optional) {
        effectType = `Schema.optional(${effectType})`;
      }

      return `  ${field.name}: ${effectType}`;
    }));

    const tableDescription = description
      ? `\n/**\n * ${description.replace(/'/g, "\\'")}\n */`
      : '';

    return `${tableDescription}
export class ${className} extends Schema.Class<${className}>("${className}")({
${fieldDefinitions.join(",\n")}
}) {}
`;
  }).join('\n');

  return `${imports}\n${tableClasses}`;
} 