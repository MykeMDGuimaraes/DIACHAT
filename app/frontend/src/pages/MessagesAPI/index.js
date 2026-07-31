import React, { useMemo, useState } from "react";
import {
  Button, Card, CardContent, Chip, CircularProgress, Divider, Grid,
  Paper, Tab, Tabs, TextField, Typography
} from "@material-ui/core";
import { makeStyles } from "@material-ui/core/styles";
import axios from "axios";
import { toast } from "react-toastify";
import toastError from "../../errors/toastError";

const apiBase = () => `${process.env.REACT_APP_BACKEND_URL || ""}/api/v1`;
const methods = ["get", "post", "put", "patch", "delete"];
const methodColor = { get: "default", post: "primary", put: "secondary", patch: "secondary", delete: "secondary" };
const useStyles = makeStyles(theme => ({
  root: { flex: 1, padding: theme.spacing(3), paddingBottom: 96 },
  card: { marginBottom: theme.spacing(2) }, code: { margin: 0, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word", padding: theme.spacing(2), borderRadius: 4, background: theme.palette.type === "dark" ? "#20242b" : "#f4f6f8" },
  endpoint: { cursor: "pointer", marginBottom: theme.spacing(1), textAlign: "left", justifyContent: "flex-start" },
  method: { minWidth: 60, marginRight: theme.spacing(1), textTransform: "uppercase" },
  small: { color: theme.palette.text.secondary, fontSize: 13 }, header: { marginBottom: theme.spacing(2) }
}));

const dereference = (spec, value) => {
  if (!value || !value.$ref) return value || {};
  return value.$ref.split("/").slice(1).reduce((current, part) => current && current[part], spec) || {};
};
const schemaExample = (spec, schema) => {
  const resolved = dereference(spec, schema);
  if (resolved.example !== undefined) return resolved.example;
  if (resolved.enum) return resolved.enum[0];
  if (resolved.const !== undefined) return resolved.const;
  if (resolved.type === "array") return [schemaExample(spec, resolved.items || {})];
  if (resolved.type === "object" || resolved.properties) return Object.entries(resolved.properties || {}).reduce((value, [key, property]) => ({ ...value, [key]: schemaExample(spec, property) }), {});
  if (resolved.type === "integer" || resolved.type === "number") return resolved.minimum || 1;
  if (resolved.type === "boolean") return false;
  if (resolved.format === "uuid") return "00000000-0000-4000-8000-000000000001";
  if (resolved.format === "date-time") return new Date().toISOString();
  return "string";
};
const endpointList = spec => Object.entries(spec?.paths || {}).flatMap(([path, value]) => methods.filter(method => value[method]).map(method => ({ path, method, operation: value[method] }))).filter(item => Array.isArray(item.operation.security) && item.operation.security.some(entry => Object.prototype.hasOwnProperty.call(entry, "ApiKey")));
const endpointGroup = path => path.includes("webhook") ? "Webhooks" : path.includes("template") ? "Templates" : path.includes("conversation") ? "Conversas" : path.includes("presence") ? "Presença" : path.includes("media") ? "Mídia" : path.includes("credential") ? "Credenciais" : path.includes("integration") || path.includes("openapi") ? "Integração" : "Mensagens";
const randomKey = () => (window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
const operationBody = (spec, operation) => {
  const json = operation?.requestBody?.content?.["application/json"]?.schema;
  return JSON.stringify(json ? schemaExample(spec, json) : {}, null, 2);
};
const scopeFor = operation => operation?.["x-required-scope"] || operation?.["x-required-scopes"] || "Conforme credencial e rota";

const MessagesAPI = () => {
  const classes = useStyles();
  const [apiKey, setApiKey] = useState(""); const [spec, setSpec] = useState(null); const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState(0); const [selected, setSelected] = useState(null); const [payload, setPayload] = useState("{}"); const [pathValues, setPathValues] = useState({}); const [queryValues, setQueryValues] = useState({}); const [file, setFile] = useState(null); const [response, setResponse] = useState(null); const [idempotencyKey, setIdempotencyKey] = useState("");
  const endpoints = useMemo(() => endpointList(spec), [spec]);
  const selectedOperation = selected && endpoints.find(item => item.path === selected.path && item.method === selected.method);
  const loadSpec = async () => {
    if (!apiKey.trim()) { toast.error("Informe uma API key para carregar o contrato."); return; }
    setLoading(true); setResponse(null);
    try { const result = await axios.get(`${apiBase()}/openapi.json`, { headers: { Authorization: `Bearer ${apiKey.trim()}` } }); setSpec(result.data); setSelected(null); toast.success("Contrato OpenAPI carregado."); }
    catch (error) { setSpec(null); toastError(error); }
    finally { setLoading(false); }
  };
  const choose = item => { setSelected(item); setPayload(operationBody(spec, item.operation)); setPathValues({}); setQueryValues({}); setFile(null); setResponse(null); setIdempotencyKey(""); };
  const invoke = async () => {
    if (!selectedOperation || !apiKey) return;
    if (["delete", "patch"].includes(selectedOperation.method) && !window.confirm("Esta operação pode alterar ou remover uma mensagem. Deseja continuar?")) return;
    let body;
    try { body = payload.trim() ? JSON.parse(payload) : undefined; } catch { toast.error("O corpo da requisição precisa ser JSON válido."); return; }
    let url = `${apiBase()}${selectedOperation.path}`;
    (selectedOperation.operation.parameters || []).filter(parameter => parameter.in === "path").forEach(parameter => { url = url.replace(`{${parameter.name}}`, encodeURIComponent(pathValues[parameter.name] || "")); });
    const headers = { Authorization: `Bearer ${apiKey.trim()}` };
    if (selectedOperation.operation.parameters?.some(parameter => parameter.in === "header" && parameter.name === "Idempotency-Key")) headers["Idempotency-Key"] = idempotencyKey || randomKey();
    const request = { method: selectedOperation.method, url, params: queryValues, headers, validateStatus: () => true };
    if (file) { const form = new FormData(); Object.entries(body || {}).forEach(([key, value]) => form.append(key, typeof value === "string" ? value : JSON.stringify(value))); form.append("media", file); request.data = form; }
    else if (!["get", "delete"].includes(selectedOperation.method)) { request.headers["Content-Type"] = "application/json"; request.data = body; }
    try { const result = await axios.request(request); setResponse({ status: result.status, headers: { "idempotent-replayed": result.headers["idempotent-replayed"], "retry-after": result.headers["retry-after"], "x-ratelimit-remaining": result.headers["x-ratelimit-remaining"] }, body: result.data }); }
    catch (error) { toastError(error); }
  };
  const curl = () => {
    if (!selectedOperation) return "";
    const key = "$DIA_CHAT_API_KEY"; let url = `$BASE_URL/api/v1${selectedOperation.path}`;
    const args = [`curl -X ${selectedOperation.method.toUpperCase()} "${url}"`, `  -H "Authorization: Bearer ${key}"`];
    if (selectedOperation.operation.parameters?.some(parameter => parameter.in === "header" && parameter.name === "Idempotency-Key")) args.push('  -H "Idempotency-Key: <uuid>"');
    if (selectedOperation.operation.requestBody?.content?.["multipart/form-data"]) args.push('  -F "connectionId=<id>"', '  -F "to=<telefone>"', '  -F "type=<image|audio|video|document>"', '  -F "media=@./arquivo"');
    else if (!["get", "delete"].includes(selectedOperation.method)) args.push('  -H "Content-Type: application/json"', `  -d '${payload}'`);
    return args.join(" \\\n");
  };
  const copy = value => navigator.clipboard?.writeText(value).then(() => toast.success("Copiado."));
  const parameters = selectedOperation?.operation?.parameters || [];
  return <Paper className={classes.root} variant="outlined">
    <Typography className={classes.header} variant="h5">Portal de Desenvolvedor — API Pública</Typography>
    <Typography color="textSecondary" paragraph>Documentação viva e console de teste para <code>/api/v1</code>. A chave permanece apenas na memória desta página e nunca é salva no navegador.</Typography>
    <Card className={classes.card}><CardContent><Grid container spacing={2} alignItems="center"><Grid item xs={12} md={9}><TextField label="API key (dch_live_*)" value={apiKey} onChange={event => setApiKey(event.target.value)} type="password" fullWidth variant="outlined" autoComplete="off" /></Grid><Grid item xs={12} md={3}><Button color="primary" variant="contained" fullWidth onClick={loadSpec} disabled={loading}>{loading ? <CircularProgress size={20} /> : "Carregar contrato"}</Button></Grid></Grid></CardContent></Card>
    {!spec ? <Card><CardContent><Typography variant="h6">Comece aqui</Typography><ol><li>Crie uma API key limitada à conexão da empresa.</li><li>Carregue o OpenAPI com a chave; o contrato informa headers, parâmetros e respostas.</li><li>Consulte <code>GET /integration/ready</code> antes do primeiro envio.</li><li>Use <code>Idempotency-Key</code> em mutações duráveis.</li><li>Configure webhook HMAC e deduplique por <code>event.id</code>.</li></ol><Typography className={classes.small}>Scopes disponíveis: messages:write, messages:manage, reactions:write, presence:write, conversations:read, conversations:write, transcript:read, media:read, templates:write e integration:read.</Typography></CardContent></Card> : <>
      <Tabs value={tab} onChange={(_event, value) => setTab(value)} indicatorColor="primary" textColor="primary"><Tab label="Endpoints" /><Tab label="Webhooks" /><Tab label="Como funciona" /></Tabs><Divider />
      {tab === 0 && <Grid container spacing={2} style={{ marginTop: 8 }}><Grid item xs={12} md={4}>{Object.entries(endpoints.reduce((groups, item) => ({ ...groups, [endpointGroup(item.path)]: [...(groups[endpointGroup(item.path)] || []), item] }), {})).map(([group, items]) => <div key={group}><Typography variant="subtitle2" color="textSecondary">{group}</Typography>{items.map(item => <Button key={`${item.method}:${item.path}`} className={classes.endpoint} fullWidth onClick={() => choose(item)} variant={selected?.path === item.path && selected?.method === item.method ? "contained" : "text"}><Chip className={classes.method} size="small" color={methodColor[item.method]} label={item.method} />{item.path}</Button>)}</div>)}</Grid><Grid item xs={12} md={8}>{!selectedOperation ? <Card><CardContent>Selecione um endpoint para ver autenticação, schema, exemplos e console.</CardContent></Card> : <>
          <Card className={classes.card}><CardContent><Chip className={classes.method} color={methodColor[selectedOperation.method]} label={selectedOperation.method.toUpperCase()} /><Typography display="inline" variant="h6">{selectedOperation.path}</Typography><Typography paragraph>{selectedOperation.operation.summary || "Sem resumo publicado."}</Typography><Typography className={classes.small}>Autenticação: Authorization: Bearer dch_live_*. Scope: {String(scopeFor(selectedOperation.operation))}. {selectedOperation.operation["x-feature-flag"] ? `Flag: ${selectedOperation.operation["x-feature-flag"]}.` : ""}</Typography></CardContent></Card>
          <Card className={classes.card}><CardContent><Typography variant="h6">Headers e parâmetros</Typography><pre className={classes.code}>{JSON.stringify({ headers: ["Authorization: Bearer dch_live_*", ...(selectedOperation.operation.parameters?.filter(item => item.in === "header").map(item => `${item.name}${item.required ? " (obrigatório)" : ""}`) || [])], parameters: parameters.map(item => ({ name: item.name, in: item.in, required: item.required, schema: dereference(spec, item.schema) })) }, null, 2)}</pre>{parameters.filter(item => item.in === "path" || item.in === "query").map(item => <TextField key={`${item.in}:${item.name}`} label={`${item.name}${item.required ? " *" : ""} (${item.in})`} value={(item.in === "path" ? pathValues : queryValues)[item.name] || ""} onChange={event => (item.in === "path" ? setPathValues : setQueryValues)(current => ({ ...current, [item.name]: event.target.value }))} fullWidth margin="dense" variant="outlined" />)}</CardContent></Card>
          <Card className={classes.card}><CardContent><Typography variant="h6">Corpo, respostas e exemplo</Typography>{selectedOperation.operation.requestBody && <TextField label="JSON da requisição" value={payload} onChange={event => setPayload(event.target.value)} multiline rows={10} fullWidth variant="outlined" margin="dense" />}{selectedOperation.operation.parameters?.some(parameter => parameter.in === "header" && parameter.name === "Idempotency-Key") && <TextField label="Idempotency-Key (repita para testar replay)" value={idempotencyKey} onChange={event => setIdempotencyKey(event.target.value)} fullWidth margin="dense" variant="outlined" />}{selectedOperation.operation.requestBody?.content?.["multipart/form-data"] && <input type="file" onChange={event => setFile(event.target.files?.[0] || null)} />}<Typography className={classes.small}>Respostas: {Object.keys(selectedOperation.operation.responses || {}).join(", ") || "não documentadas"}. 202 representa aceite durável, não entrega final.</Typography><Button style={{ marginTop: 12, marginRight: 8 }} variant="contained" color="primary" onClick={invoke}>Executar</Button><Button style={{ marginTop: 12 }} onClick={() => copy(curl())}>Copiar cURL</Button><pre className={classes.code}>{curl()}</pre>{response && <pre className={classes.code}>{JSON.stringify(response, null, 2)}</pre>}</CardContent></Card>
        </>}</Grid></Grid>}
      {tab === 1 && <Card className={classes.card}><CardContent><Typography variant="h6">Webhooks assinados</Typography><Typography paragraph>Responda rapidamente com <code>202</code> e processe em segundo plano. Entrega é at-least-once: deduplique pelo <code>event.id</code>.</Typography><pre className={classes.code}>{`X-DiaChat-Timestamp: <unix timestamp>\nX-DiaChat-Signature: sha256=<hex>\n\nHMAC-SHA256(secret, timestamp + "." + rawBody)`}</pre><Typography className={classes.small}>429, falhas de rede e 5xx sofrem retry; 401 pausa a assinatura; 413 e 422 vão para dead-letter.</Typography></CardContent></Card>}
      {tab === 2 && <Card className={classes.card}><CardContent><Typography variant="h6">Semântica operacional</Typography><ul><li><code>Idempotency-Key</code> é obrigatória em comandos duráveis.</li><li><code>Idempotent-Replayed: true</code> indica resposta reproduzida com segurança.</li><li><code>409</code> indica conflito de idempotência, requisição em andamento ou epoch obsoleto.</li><li><code>422 CAPABILITY_NOT_SUPPORTED</code> indica recurso indisponível no provider.</li><li>Presença é efêmera, sofre rate limit e não entra na outbox.</li></ul><Typography variant="subtitle2">Axios</Typography><pre className={classes.code}>{`await axios.post("$BASE_URL/api/v1/messages", payload, { headers: { Authorization: "Bearer " + apiKey, "Idempotency-Key": crypto.randomUUID() } });`}</pre><Typography variant="subtitle2">n8n</Typography><Typography className={classes.small}>No HTTP Request, use POST para <code>/api/v1/messages</code>, envie <code>Authorization: Bearer dch_live_*</code> e <code>Idempotency-Key</code>. Para webhooks, habilite Raw Body e valide <code>HMAC-SHA256(secret, timestamp + "." + rawBody)</code> antes de processar o evento.</Typography></CardContent></Card>}
    </>}
  </Paper>;
};
export default MessagesAPI;
