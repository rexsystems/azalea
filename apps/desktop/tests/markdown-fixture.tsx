import { renderToStaticMarkup } from "react-dom/server";
import { AiMarkdown } from "../src/components/AiMarkdown";

export function html() {
  return renderToStaticMarkup(
    <AiMarkdown
      text={`### Heading

- **bold** and \`inline code\`
- another item

| Name | Value |
| --- | --- |
| test | yes |

[unsafe](javascript:alert)
<script>alert(1)</script>

\`\`\`write path=/tmp/test.conf
hello
\`\`\`
`}
      pendingApprove={[
        { type: "write", path: "/tmp/test.conf", content: "hello" },
      ]}
    />,
  );
}
