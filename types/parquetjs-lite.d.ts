// parquetjs-lite ships no types. lib/readings/archive.ts is the only consumer and treats the
// module as untyped on purpose — it uses three entry points and decodes the rows itself, so a
// hand-written full typing would be more surface to keep true than it is worth.
//
// Note for anyone extending the schemas: TIMESTAMP_MILLIS is broken in this library on Node 22+
// ("Cannot convert a BigInt value to a number"). Store times as INT64 epoch millis.
declare module 'parquetjs-lite' {
  const parquet: any;
  export = parquet;
}
