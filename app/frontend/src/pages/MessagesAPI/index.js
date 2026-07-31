import React, { useMemo, useState } from "react";
import {
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Grid,
  Paper,
  Tab,
  Tabs,
  TextField,
  Typography
} from "@material-ui/core";
import { makeStyles } from "@material-ui/core/styles";
import { toast } from "react-toastify";
import toastError from "../../errors/toastError";
import api, { openApi } from "../../services/api";

const methods = ["get", "post", "put", "patch", "delete"];
const methodColor = {
  get: "default",
  post: "primary",
  put: "secondary",
  patch: "secondary",
  delete: "secondary"
};

const useStyles = makeStyles(theme => ({
  root: { flex: 1, padding: theme.spacing(3), paddingBottom: 96 },
  card: { marginBottom: theme.spacing(2) },
  code: {
    margin: 0,
    overflow: "auto",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    padding: theme.spacing(2),
    borderRadius: 4,
    background: theme.palette.type === "dark" ? "#20242b" : "#f4f6f8"
  },
  endpoint: {
    cursor: "pointer",
    marginBottom: theme.spacing(1),
    textAlign: "left",
    justifyContent: "flex-start"
  },
  method: { minWidth: 60, marginRight: theme.spacing(1), textTransform: "uppercase" },
  small: { color: theme.palette.text.secondary, fontSize: 13 },
  header: { marginBottom: theme.spacing(2) },
  surfaceTabs: { marginBottom: theme.spacing(2) }
}));

const dereference = (spec, value) => {
  if (!value || !value.$ref) return value || {};
  return value.$ref
    .split("/")
    .slice(1)
    .reduce((current, part) => current && current[part], spec) || {};
};

const schemaExample = (spec, schema) => {
  const resolved = dereference(spec, schema);
  if (resolved.example !== undefined) return resolved.example;
  if (resolved.enum) return resolved.enum[0];
  if (resolved.const !== undefined) return resolved.const;
  if (resolved.type === "array") return [schemaExample(spec, resolved.items || {})];
  if (resolved.type === "object" || resolved.properties) {
    return Object.entries(resolved.properties || {}).reduce(
      (value, [key, property]) => ({ ...value, [key]: schemaExample(spec, property) }),
      {}
    );
  }
  if (resolved.type === "integer" || resolved.type === "number") return resolved.minimum || 1;
  if (resolved.type === "boolean") return false;
  if (resolved.format === "uuid") return "00000000-0000-4000-8000-000000000001";
  if (resolved.format === "date-time") return new Date().toISOString();
  return "string";
};

const endpointList = spec =>
  Object.entries(spec?.paths || {}).flatMap(([path, value]) =>
    methods
      .filter(method => value[method])
      .map(method => ({ path, method, operation: value[method] }))
  );

const endpointGroup = path => {
  if (path.includes("webhook")) return "Webhooks";
  if (path.includes("credential")) return "Credenciais";
  if (path.includes("channels")) return "Canais oficiais";
  if (path.includes("template")) return "Templates";
  if (path.includes("conversation")) return "Conversas";
  if (path.includes("presence")) return "Presença";
  if (path.includes("media")) return "Mídia";
  if (path.includes("integration") || path.includes("openapi")) return "Integração";
  return "Mensagens";
};

const randomKey = () =>
  window.crypto?.randomUUID
    ? window.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const operationBody = (spec, operation) => {
  const json = operation?.requestBody?.content?.["application/json"]?.schema;
  return JSON.stringify(json ? schemaExample(spec, json) : {}, null, 2);
};

const MessagesAPI = () => {
  const classes = useStyles();
  const [surface, setSurface] = useState("public");
  const [apiKey, setApiKey] = useState("");
  const [spec, setSpec] = useState(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState(0);
  const [selected, setSelected] = useState(null);
  const [payload, setPayload] = useState("{}");
  const [pathValues, setPathValues] = useState({});
  const [queryValues, setQueryValues] = useState({});
  const [file, setFile] = useState(null);
  const [response, setResponse] = useState(null);
  const [idempotencyKey, setIdempotencyKey] = useState("");

  const endpoints = useMemo(() => endpointList(spec), [spec]);
  const selectedOperation =
    selected && endpoints.find(item => item.path === selected.path && item.method === selected.method);

  const changeSurface = (_event, value) => {
    setSurface(value);
    setSpec(null);
    setSelected(null);
    setResponse(null);
  };

  const loadSpec = async () => {
    if (surface === "public" && !apiKey.trim()) {
      toast.error("Informe uma API key para carregar o contrato público.");
      return;
    }
    setLoading(true);
    setResponse(null);
    try {
      const result =
        surface === "public"
          ? await openApi.get("/api/v1/openapi.json", {
              headers: { Authorization: `Bearer ${apiKey.trim()}` }
            })
          : await api.get("/api/v1/admin/openapi.json");
      setSpec(result.data);
      setSelected(null);
      toast.success("Contrato OpenAPI carregado.");
    } catch (error) {
      setSpec(null);
      toastError(error);
    } finally {
      setLoading(false);
    }
  };

  const choose = item => {
    setSelected(item);
    setPayload(operationBody(spec, item.operation));
    setPathValues({});
    setQueryValues({});
    setFile(null);
    setResponse(null);
    setIdempotencyKey("");
  };

  const invoke = async () => {
    if (!selectedOperation || (surface === "public" && !apiKey.trim())) return;
    if (["delete", "patch", "put"].includes(selectedOperation.method) &&
      !window.confirm("Esta operação altera dados. Deseja continuar?")) return;

    let body;
    try {
      body = payload.trim() ? JSON.parse(payload) : undefined;
    } catch {
      toast.error("O corpo da requisição precisa ser JSON válido.");
      return;
    }

    let url = selectedOperation.path;
    (selectedOperation.operation.parameters || [])
      .filter(parameter => parameter.in === "path")
      .forEach(parameter => {
        url = url.replace(`{${parameter.name}}`, encodeURIComponent(pathValues[parameter.name] || ""));
      });

    const headers = surface === "public"
      ? { Authorization: `Bearer ${apiKey.trim()}` }
      : {};
    if ((selectedOperation.operation.parameters || []).some(
      parameter => parameter.in === "header" && parameter.name === "Idempotency-Key"
    )) headers["Idempotency-Key"] = idempotencyKey || randomKey();

    const request = {
      method: selectedOperation.method,
      url,
      params: queryValues,
      headers,
      validateStatus: () => true
    };
    const downloadsMedia =
      selectedOperation.path === "/api/v1/messages/{messageId}/media" &&
      queryValues.format === "download";
    if (downloadsMedia) request.responseType = "blob";
    if (file) {
      const form = new FormData();
      Object.entries(body || {}).forEach(([key, value]) =>
        form.append(key, typeof value === "string" ? value : JSON.stringify(value))
      );
      form.append("media", file);
      request.data = form;
    } else if (selectedOperation.operation.requestBody) {
      request.headers["Content-Type"] = "application/json";
      request.data = body;
    }

    try {
      const result = await (surface === "public" ? openApi : api).request(request);
      if (downloadsMedia && result.status >= 200 && result.status < 300) {
        const objectUrl = window.URL.createObjectURL(result.data);
        const anchor = document.createElement("a");
        anchor.href = objectUrl;
        anchor.download = `media-${pathValues.messageId || "download"}`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.URL.revokeObjectURL(objectUrl);
      }
      setResponse({
        status: result.status,
        headers: {
          "idempotent-replayed": result.headers["idempotent-replayed"],
          "retry-after": result.headers["retry-after"],
          "x-ratelimit-remaining": result.headers["x-ratelimit-remaining"]
        },
        body: downloadsMedia && result.status >= 200 && result.status < 300
          ? "Download iniciado pelo navegador."
          : result.data
      });
    } catch (error) {
      toastError(error);
    }
  };

  const curl = () => {
    if (!selectedOperation) return "";
    let url = `$BASE_URL${selectedOperation.path}`;
    Object.entries(queryValues).filter(([, value]) => value !== "").forEach(([key, value], index) => {
      url += `${index === 0 ? "?" : "&"}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
    });
    const credential = surface === "public" ? "$DIA_CHAT_API_KEY" : "<session-jwt>";
    const args = [
      `curl -X ${selectedOperation.method.toUpperCase()} "${url}"`,
      `  -H "Authorization: Bearer ${credential}"`
    ];
    if ((selectedOperation.operation.parameters || []).some(
      parameter => parameter.in === "header" && parameter.name === "Idempotency-Key"
    )) args.push(`  -H "Idempotency-Key: ${idempotencyKey || "<uuid>"}"`);
    if (selectedOperation.path === "/api/v1/messages/{messageId}/media" && queryValues.format === "download") {
      args.push('  --output "./media.bin"');
    }
    if (selectedOperation.operation.requestBody?.content?.["multipart/form-data"]) {
      args.push(
        '  -F "connectionId=<id>"',
        '  -F "to=<telefone>"',
        '  -F "type=<image|audio|video|document>"',
        '  -F "media=@./arquivo"'
      );
    } else if (selectedOperation.operation.requestBody) {
      args.push('  -H "Content-Type: application/json"', `  -d '${payload}'`);
    }
    return args.join(" \\\n");
  };

  const copy = value =>
    navigator.clipboard?.writeText(value).then(() => toast.success("Copiado."));
  const parameters = selectedOperation?.operation?.parameters || [];
  const groups = endpoints.reduce(
    (result, item) => ({
      ...result,
      [endpointGroup(item.path)]: [...(result[endpointGroup(item.path)] || []), item]
    }),
    {}
  );

  return (
    <Paper className={classes.root} variant="outlined">
      <Typography className={classes.header} variant="h5">Portal de APIs DIA CHAT</Typography>
      <Typography color="textSecondary" paragraph>
        Documentação viva para integrações públicas e administração. Segredos não são persistidos nesta página.
      </Typography>

      <Tabs className={classes.surfaceTabs} value={surface} onChange={changeSurface} indicatorColor="primary" textColor="primary">
        <Tab value="public" label="API Pública" />
        <Tab value="admin" label="Administração" />
      </Tabs>

      <Card className={classes.card}>
        <CardContent>
          <Grid container spacing={2} alignItems="center">
            {surface === "public" && (
              <Grid item xs={12} md={9}>
                <TextField label="API key (dch_live_*)" value={apiKey} onChange={event => setApiKey(event.target.value)} type="password" fullWidth variant="outlined" autoComplete="off" />
              </Grid>
            )}
            <Grid item xs={12} md={surface === "public" ? 3 : 12}>
              <Button color="primary" variant="contained" fullWidth onClick={loadSpec} disabled={loading}>
                {loading ? <CircularProgress size={20} /> : surface === "public" ? "Carregar contrato público" : "Carregar contrato administrativo"}
              </Button>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {!spec ? (
        <Card><CardContent><Typography variant="h6">Comece aqui</Typography><Typography className={classes.small}>{surface === "public" ? "Use uma credencial dch_live_* com os scopes necessários." : "O contrato administrativo usa a sessão atual e exige perfil admin ou superadmin."}</Typography></CardContent></Card>
      ) : (
        <>
          <Tabs value={tab} onChange={(_event, value) => setTab(value)} indicatorColor="primary" textColor="primary">
            <Tab label="Endpoints" /><Tab label="Webhooks" /><Tab label="Como funciona" />
          </Tabs>
          <Divider />

          {tab === 0 && (
            <Grid container spacing={2} style={{ marginTop: 8 }}>
              <Grid item xs={12} md={4}>
                {Object.entries(groups).map(([group, items]) => (
                  <div key={group}>
                    <Typography variant="subtitle2" color="textSecondary">{group}</Typography>
                    {items.map(item => (
                      <Button key={`${item.method}:${item.path}`} className={classes.endpoint} fullWidth onClick={() => choose(item)} variant={selected?.path === item.path && selected?.method === item.method ? "contained" : "text"}>
                        <Chip className={classes.method} size="small" color={methodColor[item.method]} label={item.method} />{item.path}
                      </Button>
                    ))}
                  </div>
                ))}
              </Grid>
              <Grid item xs={12} md={8}>
                {!selectedOperation ? <Card><CardContent>Selecione um endpoint para ver contrato e console.</CardContent></Card> : (
                  <>
                    <Card className={classes.card}><CardContent><Chip className={classes.method} color={methodColor[selectedOperation.method]} label={selectedOperation.method.toUpperCase()} /><Typography display="inline" variant="h6">{selectedOperation.path}</Typography><Typography paragraph>{selectedOperation.operation.summary}</Typography><Typography className={classes.small}>Autenticação: {surface === "public" ? "Bearer dch_live_*" : "sessão administrativa"}. {surface === "public" ? `Scope: ${selectedOperation.operation["x-required-scope"]}.` : "Perfil: admin ou superadmin."} {selectedOperation.operation["x-feature-flag"] ? `Flag: ${selectedOperation.operation["x-feature-flag"]}.` : ""}</Typography></CardContent></Card>
                    <Card className={classes.card}><CardContent><Typography variant="h6">Headers e parâmetros</Typography><pre className={classes.code}>{JSON.stringify({ headers: [surface === "public" ? "Authorization: Bearer dch_live_*" : "Authorization: Bearer <session-jwt>", ...parameters.filter(item => item.in === "header").map(item => `${item.name}${item.required ? " (obrigatório)" : ""}`)], parameters: parameters.map(item => ({ name: item.name, in: item.in, required: item.required, schema: dereference(spec, item.schema) })) }, null, 2)}</pre>{parameters.filter(item => item.in === "path" || item.in === "query").map(item => <TextField key={`${item.in}:${item.name}`} label={`${item.name}${item.required ? " *" : ""} (${item.in})`} value={(item.in === "path" ? pathValues : queryValues)[item.name] || ""} onChange={event => (item.in === "path" ? setPathValues : setQueryValues)(current => ({ ...current, [item.name]: event.target.value }))} fullWidth margin="dense" variant="outlined" />)}</CardContent></Card>
                    <Card className={classes.card}><CardContent><Typography variant="h6">Corpo, respostas e exemplo</Typography>{selectedOperation.operation.requestBody && <TextField label="JSON da requisição" value={payload} onChange={event => setPayload(event.target.value)} multiline rows={10} fullWidth variant="outlined" margin="dense" />}{parameters.some(parameter => parameter.in === "header" && parameter.name === "Idempotency-Key") && <TextField label="Idempotency-Key (repita para testar replay)" value={idempotencyKey} onChange={event => setIdempotencyKey(event.target.value)} fullWidth margin="dense" variant="outlined" />}{selectedOperation.operation.requestBody?.content?.["multipart/form-data"] && <input type="file" onChange={event => setFile(event.target.files?.[0] || null)} />}<Typography className={classes.small}>Respostas documentadas: {Object.keys(selectedOperation.operation.responses || {}).join(", ")}.</Typography><pre className={classes.code}>{JSON.stringify(selectedOperation.operation.responses || {}, null, 2)}</pre><Button style={{ marginTop: 12, marginRight: 8 }} variant="contained" color="primary" onClick={invoke}>Executar</Button><Button style={{ marginTop: 12 }} onClick={() => copy(curl())}>Copiar cURL</Button><pre className={classes.code}>{curl()}</pre>{response && <pre className={classes.code}>{JSON.stringify(response, null, 2)}</pre>}</CardContent></Card>
                  </>
                )}
              </Grid>
            </Grid>
          )}

          {tab === 1 && <Card className={classes.card}><CardContent><Typography variant="h6">Webhooks assinados</Typography><Typography paragraph>Entrega at-least-once; deduplique por <code>event.id</code> e responda rapidamente.</Typography><pre className={classes.code}>{`X-DiaChat-Timestamp: <unix timestamp>\nX-DiaChat-Signature: sha256=<hex>\n\nHMAC-SHA256(secret, timestamp + "." + rawBody)`}</pre></CardContent></Card>}
          {tab === 2 && <Card className={classes.card}><CardContent><Typography variant="h6">Semântica operacional</Typography><ul><li><code>202</code> significa aceite durável, não entrega final.</li><li><code>Idempotent-Replayed: true</code> identifica replay seguro.</li><li><code>409</code> cobre conflito, requisição em andamento ou epoch obsoleto.</li><li>Endpoints administrativos usam a sessão atual; API keys não acessam essa superfície.</li></ul></CardContent></Card>}
        </>
      )}
    </Paper>
  );
};

export default MessagesAPI;
