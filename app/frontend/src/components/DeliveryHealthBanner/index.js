import React, { useContext, useEffect, useState } from "react";
import { makeStyles } from "@material-ui/core";
import { Warning } from "@material-ui/icons";

import { SocketContext } from "../../context/Socket/SocketContext";
import { i18n } from "../../translate/i18n";

const useStyles = makeStyles((theme) => ({
  banner: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 12px",
    fontSize: 13,
    backgroundColor: theme.mode === "light" ? "#fff4e5" : "#4a3a1e",
    color: theme.mode === "light" ? "#7a4d00" : "#ffd699",
    borderTop: "1px solid rgba(0, 0, 0, 0.08)",
  },
  icon: {
    fontSize: 18,
  },
}));

// Banner discreto de canal degradado (Hardening T5): apenas torna visível a
// degradação de entregas — nunca desabilita o input, reinicia a sessão ou
// reenvia mensagens.
const DeliveryHealthBanner = ({ ticket }) => {
  const classes = useStyles();
  const socketManager = useContext(SocketContext);
  const whatsappId = ticket?.whatsapp?.id;
  const [health, setHealth] = useState(ticket?.whatsapp?.deliveryHealth);

  useEffect(() => {
    setHealth(ticket?.whatsapp?.deliveryHealth);
  }, [ticket?.whatsapp?.deliveryHealth]);

  useEffect(() => {
    const companyId = localStorage.getItem("companyId");
    const socket = socketManager.getSocket(companyId);

    const handler = (data) => {
      if (data.action === "update" && data.whatsapp?.id === whatsappId) {
        setHealth(data.whatsapp.deliveryHealth);
      }
    };

    socket.on(`company-${companyId}-whatsapp`, handler);

    return () => {
      socket.off(`company-${companyId}-whatsapp`, handler);
    };
  }, [whatsappId, socketManager]);

  if (health !== "degraded") return null;

  return (
    <div className={classes.banner} role="status">
      <Warning className={classes.icon} />
      <span>{i18n.t("messagesList.delivery.channelDegraded")}</span>
    </div>
  );
};

export default DeliveryHealthBanner;
