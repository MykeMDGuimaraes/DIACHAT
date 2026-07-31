import React, { useEffect, useMemo, useState } from "react";
import { Button, CircularProgress, Grid, Paper, TextField, Typography } from "@material-ui/core";
import { makeStyles } from "@material-ui/core/styles";
import axios from "axios";
import toastError from "../../errors/toastError";

const useStyles = makeStyles(theme => ({ root: { flex: 1, padding: theme.spacing(3), paddingBottom: 96 }, code: { whiteSpace: "pre-wrap", wordBreak: "break-word", padding: theme.spacing(2), background: theme.palette.type === "dark" ? "#20242b" : "#f5f5f5", borderRadius: 4 }, form: { maxWidth: 720 } }));
const apiBase = () => `${process.env.REACT_APP_BACKEND_URL || ""}/api/v1`;

/** Console deliberately consumes the real OpenAPI document: the UI never marks Meta as available. */
const MessagesAPI = () => {
  const classes = useStyles();
  const [spec, setSpec] = useState(null); const [loading, setLoading] = useState(true);
  const [token, setToken] = useState(""); const [connectionId, setConnectionId] = useState(""); const [to, setTo] = useState(""); const [text, setText] = useState(""); const [result, setResult] = useState("");
  useEffect(() => { axios.get(`${apiBase()}/openapi.json`, { headers: token ? { Authorization: `Bearer ${token}` } : {} }).then(response => setSpec(response.data)).catch(() => setSpec(null)).finally(() => setLoading(false)); }, [token]);
  const baileyEndpoints = useMemo(() => Object.entries(spec?.paths || {}).filter(([, value]) => JSON.stringify(value).includes('"x-phase":"1"') || JSON.stringify(value).includes('"x-phase": "1"') || true).map(([path]) => path).filter(path => !path.includes("meta-cloud")), [spec]);
  const send = async event => { event.preventDefault(); try { const response = await axios.post(`${apiBase()}/messages`, { connectionId: Number(connectionId), to, type: "text", text }, { headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": crypto.randomUUID() } }); setResult(JSON.stringify(response.data, null, 2)); } catch (error) { toastError(error); } };
  return <Paper className={classes.root} variant="outlined">
    <Typography variant="h5">API Pública DIA CHAT</Typography>
    <Typography color="textSecondary" paragraph>Portal da API /api/v1. Recursos Baileys disponíveis nesta fase; Meta Cloud permanece apenas no roadmap.</Typography>
    <form className={classes.form} onSubmit={send}><Grid container spacing={2}>
      <Grid item xs={12}><TextField label="API key dch_live_*" type="password" value={token} onChange={event => setToken(event.target.value)} fullWidth required variant="outlined" /></Grid>
      <Grid item xs={12} sm={6}><TextField label="Connection ID" value={connectionId} onChange={event => setConnectionId(event.target.value)} fullWidth required variant="outlined" /></Grid>
      <Grid item xs={12} sm={6}><TextField label="Destinatário" value={to} onChange={event => setTo(event.target.value)} fullWidth required variant="outlined" /></Grid>
      <Grid item xs={12}><TextField label="Texto" value={text} onChange={event => setText(event.target.value)} fullWidth required multiline rows={3} variant="outlined" /></Grid>
      <Grid item xs={12}><Button type="submit" variant="contained" color="primary">Testar POST /messages</Button></Grid>
    </Grid></form>
    <Typography variant="h6" style={{ marginTop: 24 }}>Contrato publicado</Typography>
    {loading ? <CircularProgress size={24} /> : <pre className={classes.code}>{spec ? `OpenAPI ${spec.info.version}\n\nEndpoints Baileys:\n${baileyEndpoints.join("\n")}` : "Informe uma API key válida para carregar /api/v1/openapi.json."}</pre>}
    {result && <><Typography variant="h6">Resposta</Typography><pre className={classes.code}>{result}</pre></>}
  </Paper>;
};
export default MessagesAPI;
