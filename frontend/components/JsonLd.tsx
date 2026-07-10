// Renders a JSON-LD structured-data block. `data` is always our own static
// object (never user input), so serializing it is safe; we still escape "<" to
// avoid any chance of breaking out of the <script> element.
export function JsonLd({ data }: { data: object }) {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}
