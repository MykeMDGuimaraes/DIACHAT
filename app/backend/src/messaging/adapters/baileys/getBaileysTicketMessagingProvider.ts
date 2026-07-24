import GetTicketWbot from "../../../helpers/GetTicketWbot";
import BaileysTicketMessagingProvider from "./BaileysTicketMessagingProvider";

const baileysTicketMessagingProvider = new BaileysTicketMessagingProvider(
  GetTicketWbot
);

export default baileysTicketMessagingProvider;
