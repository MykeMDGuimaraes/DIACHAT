import { resolveContactJid, sendBaileysSocketMessage } from "../../messaging/public/baileys";
import { proto, WASocket } from "../../messaging/public/baileys";
import Contact from "../../models/Contact";
import Setting from "../../models/Setting";
import Ticket from "../../models/Ticket";
import {
  getBodyMessage,
  isNumeric,
  sleep,
  validaCpfCnpj,
  sendMessageImage,
  sendMessageLink
} from "./wbotMessageListener";
import formatBody from "../../helpers/Mustache";

import puppeteer from "puppeteer";

import axios from "axios";
import UpdateTicketService from "../TicketServices/UpdateTicketService";
import fs from "fs";

export const provider = async (
  ticket: Ticket,
  msg: proto.IWebMessageInfo,
  companyId: number,
  contact: Contact,
  wbot: WASocket
) => {
  const ticketJid = resolveContactJid({
    number: ticket.contact.number,
    lid: ticket.contact.lid,
    jidServer: ticket.contact.jidServer,
    isGroup: ticket.isGroup
  });
  const filaescolhida = ticket.queue?.name;
  if (
    filaescolhida === "2ª Via de Boleto" ||
    filaescolhida === "2 Via de Boleto"
  ) {
    let cpfcnpj;
    cpfcnpj = getBodyMessage(msg);
    cpfcnpj = cpfcnpj.replace(/\./g, "");
    cpfcnpj = cpfcnpj.replace("-", "");
    cpfcnpj = cpfcnpj.replace("/", "");
    cpfcnpj = cpfcnpj.replace(" ", "");
    cpfcnpj = cpfcnpj.replace(",", "");

    const asaastoken = await Setting.findOne({
      where: {
        key: "asaas",
        companyId
      }
    });
    const ixcapikey = await Setting.findOne({
      where: {
        key: "tokenixc",
        companyId
      }
    });
    const urlixcdb = await Setting.findOne({
      where: {
        key: "ipixc",
        companyId
      }
    });
    const ipmkauth = await Setting.findOne({
      where: {
        key: "ipmkauth",
        companyId
      }
    });
    const clientidmkauth = await Setting.findOne({
      where: {
        key: "clientidmkauth",
        companyId
      }
    });
    const clientesecretmkauth = await Setting.findOne({
      where: {
        key: "clientsecretmkauth",
        companyId
      }
    });

    let urlmkauth = ipmkauth.value;
    if (urlmkauth.substr(-1) === "/") {
      urlmkauth = urlmkauth.slice(0, -1);
    }

    //VARS
    let url = `${urlmkauth}/api/`;
    const Client_Id = clientidmkauth.value;
    const Client_Secret = clientesecretmkauth.value;
    const ixckeybase64 = btoa(ixcapikey.value);
    const urlixc = urlixcdb.value;
    const asaastk = asaastoken.value;

    let numberCPFCNPJ = cpfcnpj;

    if (urlmkauth !== "" && Client_Id !== "" && Client_Secret !== "") {
      if (isNumeric(numberCPFCNPJ) === true) {
        if (cpfcnpj.length > 2) {
          const isCPFCNPJ = validaCpfCnpj(numberCPFCNPJ);
          if (isCPFCNPJ) {
            const textMessage = {
              text: formatBody(
                `Aguarde! Estamos consultando na base de dados!`,
                contact
              )
            };
            try {
              await sleep(2000);
              await sendBaileysSocketMessage(
                wbot,
                ticketJid,
                textMessage
              );
            } catch (error) {}

            axios({
              rejectUnauthorized: true,
              method: "get",
              url,
              auth: {
                username: Client_Id,
                password: Client_Secret
              }
            } as any)
              .then(function (response) {
                const jtw = response.data;
                var config = {
                  method: "GET",
                  url: `${urlmkauth}/api/cliente/show/${numberCPFCNPJ}`,
                  headers: {
                    Authorization: `Bearer ${jtw}`
                  }
                };
                axios
                  .request(config as any)
                  .then(async function (responseInner1) {
                    if (responseInner1.data === "NULL") {
                      const textMessageInner2 = {
                        text: formatBody(
                          `Cadastro não localizado! *CPF/CNPJ* incorreto ou inválido. Tenta novamente!`,
                          contact
                        )
                      };
                      try {
                        await sleep(2000);
                        await sendBaileysSocketMessage(
                          wbot,
                          ticketJid,
                          textMessageInner2
                        );
                      } catch (error) {
                        console.log("Não consegui enviar a mensagem!");
                      }
                    } else {
                      let nome;
                      let qrcode;
                      let valor;
                      let bloqueado;
                      let linhadig;
                      let uuid_cliente;
                      let datavenc;
                      let titulo;
                      let valorCorrigido;

                      nome = responseInner1.data.dados_cliente.titulos.nome;
                      valor = responseInner1.data.dados_cliente.titulos.valor;
                      bloqueado =
                        responseInner1.data.dados_cliente.titulos.bloqueado;
                      uuid_cliente =
                        responseInner1.data.dados_cliente.titulos.uuid_cliente;
                      qrcode = responseInner1.data.dados_cliente.titulos.qrcode;
                      linhadig =
                        responseInner1.data.dados_cliente.titulos.linhadig;
                      datavenc =
                        responseInner1.data.dados_cliente.titulos.datavenc;
                      titulo = responseInner1.data.dados_cliente.titulos.titulo;
                      valorCorrigido = valor.replace(".", ",");

                      var curdate = new Date(datavenc);
                      const mesCorreto = curdate.getMonth() + 1;
                      const ano = ("0" + curdate.getFullYear()).slice(-4);
                      const mes = ("0" + mesCorreto).slice(-2);
                      const dia = ("0" + curdate.getDate()).slice(-2);
                      const anoMesDia = `${dia}/${mes}/${ano}`;

                      try {
                        const textMessageInner3 = {
                          text: formatBody(
                            `Localizei seu Cadastro! *${nome}* só mais um instante por favor!`,
                            contact
                          )
                        };
                        await sendBaileysSocketMessage(
                          wbot,
                          ticketJid,
                          textMessageInner3
                        );
                        const bodyBoleto = {
                          text: formatBody(
                            `Segue a segunda-via da sua Fatura!\n\n*Nome:* ${nome}\n*Valor:* R$ ${valorCorrigido}\n*Data Vencimento:* ${anoMesDia}\n*Link:* ${urlmkauth}/boleto/21boleto.php?titulo=${titulo}\n\nVou mandar o *código de barras* na próxima mensagem para ficar mais fácil para você copiar!`,
                            contact
                          )
                        };
                        await sleep(2000);
                        await sendBaileysSocketMessage(
                          wbot,
                          ticketJid,
                          bodyBoleto
                        );
                        const bodyLinha = {
                          text: formatBody(`${linhadig}`, contact)
                        };
                        await sleep(2000);
                        await sendBaileysSocketMessage(
                          wbot,
                          ticketJid,
                          bodyLinha
                        );
                        if (qrcode !== null) {
                          const bodyPdf = {
                            text: formatBody(
                              `Este é o *PIX COPIA E COLA*`,
                              contact
                            )
                          };
                          await sleep(2000);
                          await sendBaileysSocketMessage(
                            wbot,
                            ticketJid,
                            bodyPdf
                          );
                          const bodyqrcode = {
                            text: formatBody(`${qrcode}`, contact)
                          };
                          await sleep(2000);
                          await sendBaileysSocketMessage(
                            wbot,
                            ticketJid,
                            bodyqrcode
                          );
                          let linkBoleto = `https://chart.googleapis.com/chart?cht=qr&chs=500x500&chld=L|0&chl=${qrcode}`;
                          await sleep(2000);
                          await sendMessageImage(
                            wbot,
                            contact,
                            ticket,
                            linkBoleto,
                            ""
                          );
                        }
                        const bodyPdf = {
                          text: formatBody(
                            `Agora vou te enviar o boleto em *PDF* caso você precise.`,
                            contact
                          )
                        };
                        await sleep(2000);
                        const bodyPdfQr = {
                          text: formatBody(`${bodyPdf}`, contact)
                        };
                        await sendBaileysSocketMessage(
                          wbot,
                          ticketJid,
                          bodyPdfQr
                        );
                        await sleep(2000);

                        //GERA O PDF
                        const nomePDF = `Boleto-${nome}-${dia}-${mes}-${ano}.pdf`;
                        async () => {
                          const browser = await puppeteer.launch({
                            args: ["--no-sandbox"]
                          });
                          const page = await browser.newPage();
                          const website_url = `${urlmkauth}/boleto/21boleto.php?titulo=${titulo}`;
                          await page.goto(website_url, {
                            waitUntil: "networkidle0"
                          });
                          await page.emulateMediaType("screen");
                          // Downlaod the PDF
                          await page.pdf({
                            path: nomePDF,
                            printBackground: true,
                            format: "A4"
                          });

                          await browser.close();
                          await sendMessageLink(
                            wbot,
                            contact,
                            ticket,
                            nomePDF,
                            nomePDF
                          );
                        };

                        if (bloqueado === "sim") {
                          const bodyBloqueio = {
                            text: formatBody(
                              `${nome} vi tambem que a sua conexão esta bloqueada! Vou desbloquear para você por *48 horas*.`,
                              contact
                            )
                          };
                          await sleep(2000);
                          await sendBaileysSocketMessage(
                            wbot,
                            ticketJid,
                            bodyBloqueio
                          );
                          const bodyqrcode = {
                            text: formatBody(
                              `Estou liberando seu acesso. Por favor aguarde!`,
                              contact
                            )
                          };
                          await sleep(2000);
                          await sendBaileysSocketMessage(
                            wbot,
                            ticketJid,
                            bodyqrcode
                          );
                          var optionsdesbloq = {
                            method: "GET",
                            url: `${urlmkauth}/api/cliente/desbloqueio/${uuid_cliente}`,
                            headers: {
                              Authorization: `Bearer ${jtw}`
                            }
                          };
                          axios
                            .request(optionsdesbloq as any)
                            .then(async function (_responseUnused4) {
                              const bodyLiberado = {
                                text: formatBody(
                                  `Pronto liberei! Vou precisar que você *retire* seu equipamento da tomada.\n\n*OBS: Somente retire da tomada.* \nAguarde 1 minuto e ligue novamente!`,
                                  contact
                                )
                              };
                              await sleep(2000);
                              await sendBaileysSocketMessage(
                                wbot,
                                ticketJid,
                                bodyLiberado
                              );
                              const bodyqrcodeInner5 = {
                                text: formatBody(
                                  `Veja se seu acesso voltou! Caso nao tenha voltado retorne o contato e fale com um atendente!`,
                                  contact
                                )
                              };
                              await sleep(2000);
                              await sendBaileysSocketMessage(
                                wbot,
                                ticketJid,
                                bodyqrcodeInner5
                              );
                            })
                            .catch(async function (_errorUnused6) {
                              const bodyfinaliza = {
                                text: formatBody(
                                  `Opss! Algo de errado aconteceu! Digite *#* para voltar ao menu anterior e fale com um atendente!`,
                                  contact
                                )
                              };
                              await sendBaileysSocketMessage(
                                wbot,
                                ticketJid,
                                bodyfinaliza
                              );
                            });
                        }

                        const bodyfinaliza = {
                          text: formatBody(
                            `Estamos finalizando esta conversa! Caso precise entre em contato conosco!`,
                            contact
                          )
                        };
                        await sleep(12000);
                        await sendBaileysSocketMessage(
                          wbot,
                          ticketJid,
                          bodyfinaliza
                        );

                        await sleep(2000);
                        fs.unlink(nomePDF, function (err) {
                          if (err) throw err;
                          console.log(err);
                        });

                        await UpdateTicketService({
                          ticketData: { status: "closed" },
                          ticketId: ticket.id,
                          companyId: ticket.companyId
                        });
                      } catch (error) {
                        console.log("11 Não consegui enviar a mensagem!");
                      }
                    }
                  })
                  .catch(async function (_errorUnused7) {
                    try {
                      const bodyBoleto = {
                        text: formatBody(
                          `Não consegui encontrar seu cadastro.\n\nPor favor tente novamente!\nOu digite *#* para voltar ao *Menu Anterior*`,
                          contact
                        )
                      };
                      await sleep(2000);
                      await sendBaileysSocketMessage(
                        wbot,
                        ticketJid,
                        bodyBoleto
                      );
                    } catch (error) {
                      console.log("111 Não consegui enviar a mensagem!");
                    }
                  });
              })
              .catch(async function (_errorUnused8) {
                const bodyfinaliza = {
                  text: formatBody(
                    `Opss! Algo de errado aconteceu! Digite *#* para voltar ao menu anterior e fale com um atendente!`,
                    contact
                  )
                };
                await sendBaileysSocketMessage(
                  wbot,
                  ticketJid,
                  bodyfinaliza
                );
              });
          } else {
            const body = {
              text: formatBody(
                `Este CPF/CNPJ não é válido!\n\nPor favor tente novamente!\nOu digite *#* para voltar ao *Menu Anterior*`,
                contact
              )
            };
            await sleep(2000);
            await sendBaileysSocketMessage(
              wbot,
              ticketJid,
              body
            );
          }
        }
      }
    }

    if (asaastoken.value !== "") {
      if (isNumeric(numberCPFCNPJ) === true) {
        if (cpfcnpj.length > 2) {
          const isCPFCNPJ = validaCpfCnpj(numberCPFCNPJ);
          if (isCPFCNPJ) {
            const body = {
              text: formatBody(
                `Aguarde! Estamos consultando na base de dados!`,
                contact
              )
            };
            try {
              await sleep(2000);
              await sendBaileysSocketMessage(
                wbot,
                ticketJid,
                body
              );
            } catch (error) {}
            var optionsc = {
              method: "GET",
              url: "https://www.asaas.com/api/v3/customers",
              params: { cpfCnpj: numberCPFCNPJ },
              headers: {
                "Content-Type": "application/json",
                access_token: asaastk
              }
            };

            axios
              .request(optionsc as any)
              .then(async function (response) {
                let nome;
                let id_cliente;
                let totalCount;

                nome = response?.data?.data[0]?.name;
                id_cliente = response?.data?.data[0]?.id;
                totalCount = response?.data?.totalCount;

                if (totalCount === 0) {
                  const bodyInner9 = {
                    text: formatBody(
                      `Cadastro não localizado! *CPF/CNPJ* incorreto ou inválido. Tenta novamente!`,
                      contact
                    )
                  };
                  await sleep(2000);
                  await sendBaileysSocketMessage(
                    wbot,
                    ticketJid,
                    bodyInner9
                  );
                } else {
                  const bodyInner10 = {
                    text: formatBody(
                      `Localizei seu Cadastro! \n*${nome}* só mais um instante por favor!`,
                      contact
                    )
                  };
                  await sleep(2000);
                  await sendBaileysSocketMessage(
                    wbot,
                    ticketJid,
                    bodyInner10
                  );
                  var optionsListpaymentOVERDUE = {
                    method: "GET",
                    url: "https://www.asaas.com/api/v3/payments",
                    params: { customer: id_cliente, status: "OVERDUE" },
                    headers: {
                      "Content-Type": "application/json",
                      access_token: asaastk
                    }
                  };

                  axios
                    .request(optionsListpaymentOVERDUE as any)
                    .then(async function (responseInner11) {
                      let totalCount_overdue;
                      totalCount_overdue = responseInner11?.data?.totalCount;

                      if (totalCount_overdue === 0) {
                        const bodyInner12 = {
                          text: formatBody(
                            `Você não tem nenhuma fatura vencidada! \nVou te enviar a proxima fatura. Por favor aguarde!`,
                            contact
                          )
                        };
                        await sleep(2000);
                        await sendBaileysSocketMessage(
                          wbot,
                          ticketJid,
                          bodyInner12
                        );
                        var optionsPENDING = {
                          method: "GET",
                          url: "https://www.asaas.com/api/v3/payments",
                          params: { customer: id_cliente, status: "PENDING" },
                          headers: {
                            "Content-Type": "application/json",
                            access_token: asaastk
                          }
                        };

                        axios
                          .request(optionsPENDING as any)
                          .then(async function (responseInner13) {
                            function sortfunction(a, b) {
                              return a.dueDate.localeCompare(b.dueDate);
                            }
                            const ordenado =
                              responseInner13?.data?.data.sort(sortfunction);
                            let id_payment_pending;
                            let value_pending;
                            let description_pending;
                            let invoiceUrl_pending;
                            let dueDate_pending;
                            let invoiceNumber_pending;
                            let value_pending_corrigida;
                            let dueDate_pending_corrigida;

                            id_payment_pending = ordenado[0]?.id;
                            value_pending = ordenado[0]?.value;
                            description_pending = ordenado[0]?.description;
                            invoiceUrl_pending = ordenado[0]?.invoiceUrl;
                            dueDate_pending = ordenado[0]?.dueDate;
                            invoiceNumber_pending = ordenado[0]?.invoiceNumber;

                            dueDate_pending_corrigida = dueDate_pending
                              ?.split("-")
                              ?.reverse()
                              ?.join("/");
                            value_pending_corrigida =
                              value_pending.toLocaleString("pt-br", {
                                style: "currency",
                                currency: "BRL"
                              });

                            const bodyBoleto = {
                              text: formatBody(
                                `Segue a segunda-via da sua Fatura!\n\n*Fatura:* ${invoiceNumber_pending}\n*Nome:* ${nome}\n*Valor:* R$ ${value_pending_corrigida}\n*Data Vencimento:* ${dueDate_pending_corrigida}\n*Descrição:*\n${description_pending}\n*Link:* ${invoiceUrl_pending}`,
                                contact
                              )
                            };
                            await sleep(2000);
                            await sendBaileysSocketMessage(
                              wbot,
                              ticketJid,
                              bodyBoleto
                            );
                            //GET DADOS PIX
                            var optionsGetPIX = {
                              method: "GET",
                              url: `https://www.asaas.com/api/v3/payments/${id_payment_pending}/pixQrCode`,
                              headers: {
                                "Content-Type": "application/json",
                                access_token: asaastk
                              }
                            };

                            axios
                              .request(optionsGetPIX as any)
                              .then(async function (responseInner14) {
                                let success;
                                let payload;

                                success = responseInner14?.data?.success;
                                payload = responseInner14?.data?.payload;

                                if (success === true) {
                                  const bodyPixCP = {
                                    text: formatBody(
                                      `Este é o *PIX Copia e Cola*`,
                                      contact
                                    )
                                  };
                                  await sleep(2000);
                                  await sendBaileysSocketMessage(
                                    wbot,
                                    ticketJid,
                                    bodyPixCP
                                  );
                                  const bodyPix = {
                                    text: formatBody(`${payload}`, contact)
                                  };
                                  await sleep(2000);
                                  await sendBaileysSocketMessage(
                                    wbot,
                                    ticketJid,
                                    bodyPix
                                  );
                                  let linkBoleto = `https://chart.googleapis.com/chart?cht=qr&chs=500x500&chld=L|0&chl=${payload}`;
                                  await sleep(2000);
                                  await sendMessageImage(
                                    wbot,
                                    contact,
                                    ticket,
                                    linkBoleto,
                                    ""
                                  );
                                  var optionsBoletopend = {
                                    method: "GET",
                                    url: `https://www.asaas.com/api/v3/payments/${id_payment_pending}/identificationField`,
                                    headers: {
                                      "Content-Type": "application/json",
                                      access_token: asaastk
                                    }
                                  };

                                  axios
                                    .request(optionsBoletopend as any)
                                    .then(async function (responseInner15) {
                                      let codigo_barras;
                                      codigo_barras =
                                        responseInner15.data
                                          .identificationField;
                                      const bodycodigoBarras = {
                                        text: formatBody(
                                          `${codigo_barras}`,
                                          contact
                                        )
                                      };
                                      if (
                                        responseInner15.data?.errors?.code !==
                                        "invalid_action"
                                      ) {
                                        const bodycodigo = {
                                          text: formatBody(
                                            `Este é o *Código de Barras*!`,
                                            contact
                                          )
                                        };
                                        await sleep(2000);
                                        await sendBaileysSocketMessage(
                                          wbot,
                                          ticketJid,
                                          bodycodigo
                                        );
                                        await sleep(2000);
                                        await sendBaileysSocketMessage(
                                          wbot,
                                          ticketJid,
                                          bodycodigoBarras
                                        );
                                        const bodyfinaliza = {
                                          text: formatBody(
                                            `Estamos finalizando esta conversa! Caso precise entre em contato conosco!`,
                                            contact
                                          )
                                        };
                                        await sleep(2000);
                                        await sendBaileysSocketMessage(
                                          wbot,
                                          ticketJid,
                                          bodyfinaliza
                                        );
                                        await sleep(2000);
                                        await UpdateTicketService({
                                          ticketData: { status: "closed" },
                                          ticketId: ticket.id,
                                          companyId: ticket.companyId
                                        });
                                      } else {
                                        const bodyfinaliza = {
                                          text: formatBody(
                                            `Estamos finalizando esta conversa! Caso precise entre em contato conosco!`,
                                            contact
                                          )
                                        };
                                        await sleep(2000);
                                        await sendBaileysSocketMessage(
                                          wbot,
                                          ticketJid,
                                          bodyfinaliza
                                        );
                                        await UpdateTicketService({
                                          ticketData: { status: "closed" },
                                          ticketId: ticket.id,
                                          companyId: ticket.companyId
                                        });
                                      }
                                    })
                                    .catch(async function (_errorUnused16) {
                                      const bodyfinaliza = {
                                        text: formatBody(
                                          `Estamos finalizando esta conversa! Caso precise entre em contato conosco!`,
                                          contact
                                        )
                                      };
                                      await sleep(2000);
                                      await sendBaileysSocketMessage(
                                        wbot,
                                        ticketJid,
                                        bodyfinaliza
                                      );
                                      await UpdateTicketService({
                                        ticketData: { status: "closed" },
                                        ticketId: ticket.id,
                                        companyId: ticket.companyId
                                      });
                                    });
                                }
                              })
                              .catch(async function (_errorUnused17) {
                                const bodyInner18 = {
                                  text: formatBody(
                                    `*Opss!!!!*\nOcorreu um erro! Digite *#* e fale com um *Atendente*!`,
                                    contact
                                  )
                                };
                                await sleep(2000);
                                await sendBaileysSocketMessage(
                                  wbot,
                                  ticketJid,
                                  bodyInner18
                                );
                              });
                          })
                          .catch(async function (_errorUnused19) {
                            const bodyInner20 = {
                              text: formatBody(
                                `*Opss!!!!*\nOcorreu um erro! Digite *#* e fale com um *Atendente*!`,
                                contact
                              )
                            };
                            await sleep(2000);
                            await sendBaileysSocketMessage(
                              wbot,
                              ticketJid,
                              bodyInner20
                            );
                          });
                      } else {
                        let id_payment_overdue;
                        let value_overdue;
                        let description_overdue;
                        let invoiceUrl_overdue;
                        let dueDate_overdue;
                        let invoiceNumber_overdue;

                        let value_overdue_corrigida;
                        let dueDate_overdue_corrigida;

                        id_payment_overdue = responseInner11?.data?.data[0]?.id;
                        value_overdue = responseInner11?.data?.data[0]?.value;
                        description_overdue =
                          responseInner11?.data?.data[0]?.description;
                        invoiceUrl_overdue =
                          responseInner11?.data?.data[0]?.invoiceUrl;
                        dueDate_overdue =
                          responseInner11?.data?.data[0]?.dueDate;
                        invoiceNumber_overdue =
                          responseInner11?.data?.data[0]?.invoiceNumber;

                        dueDate_overdue_corrigida = dueDate_overdue
                          ?.split("-")
                          ?.reverse()
                          ?.join("/");
                        value_overdue_corrigida = value_overdue.toLocaleString(
                          "pt-br",
                          { style: "currency", currency: "BRL" }
                        );
                        const bodyInner21 = {
                          text: formatBody(
                            `Você tem *${totalCount_overdue}* fatura(s) vencidada(s)! \nVou te enviar. Por favor aguarde!`,
                            contact
                          )
                        };
                        await sleep(2000);
                        await sendBaileysSocketMessage(
                          wbot,
                          ticketJid,
                          bodyInner21
                        );
                        const bodyBoleto = {
                          text: formatBody(
                            `Segue a segunda-via da sua Fatura!\n\n*Fatura:* ${invoiceNumber_overdue}\n*Nome:* ${nome}\n*Valor:* R$ ${value_overdue_corrigida}\n*Data Vencimento:* ${dueDate_overdue_corrigida}\n*Descrição:*\n${description_overdue}\n*Link:* ${invoiceUrl_overdue}`,
                            contact
                          )
                        };
                        await sleep(2000);
                        await sendBaileysSocketMessage(
                          wbot,
                          ticketJid,
                          bodyBoleto
                        );
                        //GET DADOS PIX
                        var optionsGetPIX = {
                          method: "GET",
                          url: `https://www.asaas.com/api/v3/payments/${id_payment_overdue}/pixQrCode`,
                          headers: {
                            "Content-Type": "application/json",
                            access_token: asaastk
                          }
                        };

                        axios
                          .request(optionsGetPIX as any)
                          .then(async function (responseInner22) {
                            let success;
                            let payload;

                            success = responseInner22?.data?.success;
                            payload = responseInner22?.data?.payload;
                            if (success === true) {
                              const bodyPixCP = {
                                text: formatBody(
                                  `Este é o *PIX Copia e Cola*`,
                                  contact
                                )
                              };
                              await sleep(2000);
                              await sendBaileysSocketMessage(
                                wbot,
                                ticketJid,
                                bodyPixCP
                              );
                              const bodyPix = {
                                text: formatBody(`${payload}`, contact)
                              };
                              await sleep(2000);
                              await sendBaileysSocketMessage(
                                wbot,
                                ticketJid,
                                bodyPix
                              );
                              let linkBoleto = `https://chart.googleapis.com/chart?cht=qr&chs=500x500&chld=L|0&chl=${payload}`;
                              await sleep(2000);
                              await sendMessageImage(
                                wbot,
                                contact,
                                ticket,
                                linkBoleto,
                                ""
                              );
                              var optionsBoleto = {
                                method: "GET",
                                url: `https://www.asaas.com/api/v3/payments/${id_payment_overdue}/identificationField`,
                                headers: {
                                  "Content-Type": "application/json",
                                  access_token: asaastk
                                }
                              };

                              axios
                                .request(optionsBoleto as any)
                                .then(async function (responseInner23) {
                                  let codigo_barras;
                                  codigo_barras =
                                    responseInner23.data.identificationField;
                                  const bodycodigoBarras = {
                                    text: formatBody(
                                      `${codigo_barras}`,
                                      contact
                                    )
                                  };
                                  if (
                                    responseInner23.data?.errors?.code !==
                                    "invalid_action"
                                  ) {
                                    const bodycodigo = {
                                      text: formatBody(
                                        `Este é o *Código de Barras*!`,
                                        contact
                                      )
                                    };
                                    await sleep(2000);
                                    await sendBaileysSocketMessage(
                                      wbot,
                                      ticketJid,
                                      bodycodigo
                                    );
                                    await sleep(2000);
                                    await sendBaileysSocketMessage(
                                      wbot,
                                      ticketJid,
                                      bodycodigoBarras
                                    );
                                    const bodyfinaliza = {
                                      text: formatBody(
                                        `Estamos finalizando esta conversa! Caso precise entre em contato conosco!`,
                                        contact
                                      )
                                    };
                                    await sleep(2000);
                                    await sendBaileysSocketMessage(
                                      wbot,
                                      ticketJid,
                                      bodyfinaliza
                                    );
                                    await UpdateTicketService({
                                      ticketData: { status: "closed" },
                                      ticketId: ticket.id,
                                      companyId: ticket.companyId
                                    });
                                  } else {
                                    const bodyfinaliza = {
                                      text: formatBody(
                                        `Estamos finalizando esta conversa! Caso precise entre em contato conosco!`,
                                        contact
                                      )
                                    };
                                    await sleep(2000);
                                    await sendBaileysSocketMessage(
                                      wbot,
                                      ticketJid,
                                      bodyfinaliza
                                    );
                                    await UpdateTicketService({
                                      ticketData: { status: "closed" },
                                      ticketId: ticket.id,
                                      companyId: ticket.companyId
                                    });
                                  }
                                })
                                .catch(function (_errorUnused24) {
                                  //console.error(error);
                                });
                            }
                          })
                          .catch(function (_errorUnused25) {});
                      }
                    })
                    .catch(async function (_errorUnused26) {
                      const bodyInner27 = {
                        text: formatBody(
                          `*Opss!!!!*\nOcorreu um erro! Digite *#* e fale com um *Atendente*!`,
                          contact
                        )
                      };
                      await sleep(2000);
                      await sendBaileysSocketMessage(
                        wbot,
                        ticketJid,
                        bodyInner27
                      );
                    });
                }
              })
              .catch(async function (_errorUnused28) {
                const bodyInner29 = {
                  text: formatBody(
                    `*Opss!!!!*\nOcorreu um erro! Digite *#* e fale com um *Atendente*!`,
                    contact
                  )
                };
                await sleep(2000);
                await sendBaileysSocketMessage(
                  wbot,
                  ticketJid,
                  bodyInner29
                );
              });
          }
        }
      }
    }

    if (ixcapikey.value !== "" && urlixcdb.value !== "") {
      if (isNumeric(numberCPFCNPJ) === true) {
        if (cpfcnpj.length > 2) {
          const isCPFCNPJ = validaCpfCnpj(numberCPFCNPJ);
          if (isCPFCNPJ) {
            if (numberCPFCNPJ.length <= 11) {
              numberCPFCNPJ = numberCPFCNPJ.replace(/(\d{3})(\d)/, "$1.$2");
              numberCPFCNPJ = numberCPFCNPJ.replace(/(\d{3})(\d)/, "$1.$2");
              numberCPFCNPJ = numberCPFCNPJ.replace(
                /(\d{3})(\d{1,2})$/,
                "$1-$2"
              );
            } else {
              numberCPFCNPJ = numberCPFCNPJ.replace(/^(\d{2})(\d)/, "$1.$2");
              numberCPFCNPJ = numberCPFCNPJ.replace(
                /^(\d{2})\.(\d{3})(\d)/,
                "$1.$2.$3"
              );
              numberCPFCNPJ = numberCPFCNPJ.replace(/\.(\d{3})(\d)/, ".$1/$2");
              numberCPFCNPJ = numberCPFCNPJ.replace(/(\d{4})(\d)/, "$1-$2");
            }
            //const token = await CheckSettingsHelper("OBTEM O TOKEN DO BANCO (dei insert na tabela settings)")
            const body = {
              text: formatBody(
                `Aguarde! Estamos consultando na base de dados!`,
                contact
              )
            };
            try {
              await sleep(2000);
              await sendBaileysSocketMessage(
                wbot,
                ticketJid,
                body
              );
            } catch (error) {}
            var options = {
              method: "GET",
              url: `${urlixc}/webservice/v1/cliente`,
              headers: {
                ixcsoft: "listar",
                Authorization: `Basic ${ixckeybase64}`
              },
              data: {
                qtype: "cliente.cnpj_cpf",
                query: numberCPFCNPJ,
                oper: "=",
                page: "1",
                rp: "1",
                sortname: "cliente.cnpj_cpf",
                sortorder: "asc"
              }
            };

            axios
              .request(options as any)
              .then(async function (response) {
                if (response.data.type === "error") {
                  console.log("Error response", response.data.message);
                  const bodyInner30 = {
                    text: formatBody(
                      `*Opss!!!!*\nOcorreu um erro! Digite *#* e fale com um *Atendente*!`,
                      contact
                    )
                  };
                  await sleep(2000);
                  await sendBaileysSocketMessage(
                    wbot,
                    ticketJid,
                    bodyInner30
                  );
                }
                if (response.data.total === 0) {
                  const bodyInner31 = {
                    text: formatBody(
                      `Cadastro não localizado! *CPF/CNPJ* incorreto ou inválido. Tenta novamente!`,
                      contact
                    )
                  };
                  try {
                    await sleep(2000);
                    await sendBaileysSocketMessage(
                      wbot,
                      ticketJid,
                      bodyInner31
                    );
                  } catch (error) {}
                } else {
                  let nome;
                  let id;

                  nome = response.data?.registros[0]?.razao;
                  id = response.data?.registros[0]?.id;

                  const bodyInner32 = {
                    text: formatBody(
                      `Localizei seu Cadastro! \n*${nome}* só mais um instante por favor!`,
                      contact
                    )
                  };
                  await sleep(2000);
                  await sendBaileysSocketMessage(
                    wbot,
                    ticketJid,
                    bodyInner32
                  );
                  var boleto = {
                    method: "GET",
                    url: `${urlixc}/webservice/v1/fn_areceber`,
                    headers: {
                      ixcsoft: "listar",
                      Authorization: `Basic ${ixckeybase64}`
                    },
                    data: {
                      qtype: "fn_areceber.id_cliente",
                      query: id,
                      oper: "=",
                      page: "1",
                      rp: "1",
                      sortname: "fn_areceber.data_vencimento",
                      sortorder: "asc",
                      grid_param:
                        '[{"TB":"fn_areceber.status", "OP" : "=", "P" : "A"}]'
                    }
                  };
                  axios
                    .request(boleto as any)
                    .then(async function (responseInner33) {
                      let valor;
                      let datavenc;
                      let datavencCorrigida;
                      let valorCorrigido;
                      let linha_digitavel;
                      let impresso;
                      let idboleto;

                      idboleto = responseInner33.data?.registros[0]?.id;
                      valor = responseInner33.data?.registros[0]?.valor;
                      datavenc =
                        responseInner33.data?.registros[0]?.data_vencimento;
                      linha_digitavel =
                        responseInner33.data?.registros[0]?.linha_digitavel;
                      impresso = responseInner33.data?.registros[0]?.impresso;
                      valorCorrigido = valor.replace(".", ",");
                      datavencCorrigida = datavenc
                        .split("-")
                        .reverse()
                        .join("/");

                      //INFORMAÇÕES BOLETO
                      //await sleep(2000)
                      //await sendBaileysSocketMessage(wbot, ticketJid, bodyBoleto);
                      //LINHA DIGITAVEL
                      if (impresso !== "S") {
                        //IMPRIME BOLETO PARA GERAR CODIGO BARRAS
                        var boletopdf = {
                          method: "GET",
                          url: `${urlixc}/webservice/v1/get_boleto`,
                          headers: {
                            ixcsoft: "listar",
                            Authorization: `Basic ${ixckeybase64}`
                          },
                          data: {
                            boletos: idboleto,
                            juro: "N",
                            multa: "N",
                            atualiza_boleto: "N",
                            tipo_boleto: "arquivo",
                            base64: "S"
                          }
                        };

                        axios
                          .request(boletopdf as any)
                          .then(function (_responseUnused34) {})
                          .catch(function (error) {
                            console.error(error);
                          });
                      }

                      //SE TIVER PIX ENVIA O PIX
                      var optionsPix = {
                        method: "GET",
                        url: `${urlixc}/webservice/v1/get_pix`,
                        headers: {
                          ixcsoft: "listar",
                          Authorization: `Basic ${ixckeybase64}`
                        },
                        data: { id_areceber: idboleto }
                      };

                      axios
                        .request(optionsPix as any)
                        .then(async function (responseInner35) {
                          let tipo;
                          let pix;

                          tipo = responseInner35.data?.type;
                          pix = responseInner35.data?.pix?.qrCode?.qrcode;
                          if (tipo === "success") {
                            const bodyBoletoPix = {
                              text: formatBody(
                                `Segue a segunda-via da sua Fatura!\n\n*Fatura:* ${idboleto}\n*Nome:* ${nome}\n*Valor:* R$ ${valorCorrigido}\n*Data Vencimento:* ${datavencCorrigida}\n\nVou te enviar o *Código de Barras* e o *PIX* basta clicar em qual você quer utlizar que já vai copiar! Depois basta realizar o pagamento no seu banco`,
                                contact
                              )
                            };
                            await sendBaileysSocketMessage(
                              wbot,
                              ticketJid,
                              bodyBoletoPix
                            );
                            const body_linhadigitavel = {
                              text: formatBody(
                                "Este é o *Código de Barras*",
                                contact
                              )
                            };
                            await sleep(2000);
                            await sendBaileysSocketMessage(
                              wbot,
                              ticketJid,
                              body_linhadigitavel
                            );
                            await sleep(2000);
                            const body_linha_digitavel = {
                              text: formatBody(`${linha_digitavel}`, contact)
                            };
                            await sendBaileysSocketMessage(
                              wbot,
                              ticketJid,
                              body_linha_digitavel
                            );
                            const body_pix = {
                              text: formatBody(
                                "Este é o *PIX Copia e Cola*",
                                contact
                              )
                            };
                            await sleep(2000);
                            await sendBaileysSocketMessage(
                              wbot,
                              ticketJid,
                              body_pix
                            );
                            await sleep(2000);
                            const body_pix_dig = {
                              text: formatBody(`${pix}`, contact)
                            };
                            await sendBaileysSocketMessage(
                              wbot,
                              ticketJid,
                              body_pix_dig
                            );
                            const body_pixqr = {
                              text: formatBody("QR CODE do *PIX*", contact)
                            };
                            await sleep(2000);
                            await sendBaileysSocketMessage(
                              wbot,
                              ticketJid,
                              body_pixqr
                            );
                            let linkBoleto = `https://chart.googleapis.com/chart?cht=qr&chs=500x500&chld=L|0&chl=${pix}`;
                            await sleep(2000);
                            await sendMessageImage(
                              wbot,
                              contact,
                              ticket,
                              linkBoleto,
                              ""
                            );
                            ///VE SE ESTA BLOQUEADO PARA LIBERAR!
                            var optionscontrato = {
                              method: "POST",
                              url: `${urlixc}/webservice/v1/cliente_contrato`,
                              headers: {
                                ixcsoft: "listar",
                                Authorization: `Basic ${ixckeybase64}`
                              },
                              data: {
                                qtype: "cliente_contrato.id_cliente",
                                query: id,
                                oper: "=",
                                page: "1",
                                rp: "1",
                                sortname: "cliente_contrato.id",
                                sortorder: "asc"
                              }
                            };
                            axios
                              .request(optionscontrato as any)
                              .then(async function (responseInner36) {
                                let status_internet;
                                let id_contrato;
                                status_internet =
                                  responseInner36.data?.registros[0]
                                    ?.status_internet;
                                id_contrato =
                                  responseInner36.data?.registros[0]?.id;
                                if (status_internet !== "A") {
                                  const bodyPdf = {
                                    text: formatBody(
                                      `*${nome}* vi tambem que a sua conexão esta bloqueada! Vou desbloquear para você.`,
                                      contact
                                    )
                                  };
                                  await sleep(2000);
                                  await sendBaileysSocketMessage(
                                    wbot,
                                    ticketJid,
                                    bodyPdf
                                  );
                                  const bodyqrcode = {
                                    text: formatBody(
                                      `Estou liberando seu acesso. Por favor aguarde!`,
                                      contact
                                    )
                                  };
                                  await sleep(2000);
                                  await sendBaileysSocketMessage(
                                    wbot,
                                    ticketJid,
                                    bodyqrcode
                                  );
                                  //REALIZANDO O DESBLOQUEIO
                                  var optionsdesbloqeuio = {
                                    method: "POST",
                                    url: `${urlixc}/webservice/v1/desbloqueio_confianca`,
                                    headers: {
                                      Authorization: `Basic ${ixckeybase64}`
                                    },
                                    data: { id: id_contrato }
                                  };

                                  axios
                                    .request(optionsdesbloqeuio as any)
                                    .then(async function (responseInner37) {
                                      let tipoInner38;
                                      let mensagem;
                                      tipoInner38 = responseInner37.data?.tipo;
                                      mensagem = responseInner37.data?.mensagem;
                                      if (tipoInner38 === "sucesso") {
                                        //DESCONECTANDO O CLIENTE PARA VOLTAR O ACESSO
                                        var optionsRadius = {
                                          method: "GET",
                                          url: `${urlixc}/webservice/v1/radusuarios`,
                                          headers: {
                                            ixcsoft: "listar",
                                            Authorization: `Basic ${ixckeybase64}`
                                          },
                                          data: {
                                            qtype: "radusuarios.id_cliente",
                                            query: id,
                                            oper: "=",
                                            page: "1",
                                            rp: "1",
                                            sortname: "radusuarios.id",
                                            sortorder: "asc"
                                          }
                                        };

                                        axios
                                          .request(optionsRadius as any)
                                          .then(async function (
                                            responseInner39
                                          ) {
                                            let tipoInner40;
                                            tipoInner40 =
                                              responseInner39.data?.type;
                                            if (tipoInner40 === "success") {
                                              const body_mensagem = {
                                                text: formatBody(
                                                  `${mensagem}`,
                                                  contact
                                                )
                                              };
                                              await sleep(2000);
                                              await sendBaileysSocketMessage(
                                                wbot,
                                                ticketJid,
                                                body_mensagem
                                              );
                                              const bodyPdfInner41 = {
                                                text: formatBody(
                                                  `Fiz os procedimentos de liberação! Agora aguarde até 5 minutos e veja se sua conexão irá retornar! .\n\nCaso não tenha voltado, retorne o contato e fale com um atendente!`,
                                                  contact
                                                )
                                              };
                                              await sleep(2000);
                                              await sendBaileysSocketMessage(
                                                wbot,
                                                ticketJid,
                                                bodyPdfInner41
                                              );
                                              const bodyfinaliza = {
                                                text: formatBody(
                                                  `Estamos finalizando esta conversa! Caso precise entre em contato conosco!`,
                                                  contact
                                                )
                                              };
                                              await sleep(2000);
                                              await sendBaileysSocketMessage(
                                                wbot,
                                                ticketJid,
                                                bodyfinaliza
                                              );
                                              await UpdateTicketService({
                                                ticketData: {
                                                  status: "closed"
                                                },
                                                ticketId: ticket.id,
                                                companyId: ticket.companyId
                                              });
                                            }
                                          })
                                          .catch(function (error) {
                                            console.error(error);
                                          });
                                        //FIM DA DESCONEXÃO
                                      } else {
                                        var msgerrolbieracao =
                                          responseInner37.data.mensagem;
                                        const bodyerro = {
                                          text: formatBody(
                                            `Ops! Ocorreu um erro e nao consegui desbloquear`,
                                            contact
                                          )
                                        };
                                        const msg_errolbieracao = {
                                          text: formatBody(
                                            `${msgerrolbieracao}`,
                                            contact
                                          )
                                        };
                                        await sleep(2000);
                                        await sendBaileysSocketMessage(
                                          wbot,
                                          ticketJid,
                                          bodyerro
                                        );
                                        await sleep(2000);
                                        await sendBaileysSocketMessage(
                                          wbot,
                                          ticketJid,
                                          msg_errolbieracao
                                        );
                                        const bodyerroatendent = {
                                          text: formatBody(
                                            `Digite *#* para voltar o menu e fale com um atendente!`,
                                            contact
                                          )
                                        };
                                        await sleep(2000);
                                        await sendBaileysSocketMessage(
                                          wbot,
                                          ticketJid,
                                          bodyerroatendent
                                        );
                                      }
                                    })
                                    .catch(async function (_errorUnused42) {
                                      const bodyerro = {
                                        text: formatBody(
                                          `Ops! Ocorreu um erro digite *#* e fale com um atendente!`,
                                          contact
                                        )
                                      };
                                      await sleep(2000);
                                      await sendBaileysSocketMessage(
                                        wbot,
                                        ticketJid,
                                        bodyerro
                                      );
                                    });
                                } else {
                                  const bodyfinaliza = {
                                    text: formatBody(
                                      `Estamos finalizando esta conversa! Caso precise entre em contato conosco!`,
                                      contact
                                    )
                                  };
                                  await sleep(8000);
                                  await sendBaileysSocketMessage(
                                    wbot,
                                    ticketJid,
                                    bodyfinaliza
                                  );
                                  await UpdateTicketService({
                                    ticketData: { status: "closed" },
                                    ticketId: ticket.id,
                                    companyId: ticket.companyId
                                  });
                                }

                                //
                              })
                              .catch(async function (_errorUnused43) {
                                const bodyerro = {
                                  text: formatBody(
                                    `Ops! Ocorreu um erro digite *#* e fale com um atendente!`,
                                    contact
                                  )
                                };
                                await sleep(2000);
                                await sendBaileysSocketMessage(
                                  wbot,
                                  ticketJid,
                                  bodyerro
                                );
                              });
                            ///VE SE ESTA BLOQUEADO PARA LIBERAR!
                          } else {
                            const bodyBoleto = {
                              text: formatBody(
                                `Segue a segunda-via da sua Fatura!\n\n*Fatura:* ${idboleto}\n*Nome:* ${nome}\n*Valor:* R$ ${valorCorrigido}\n*Data Vencimento:* ${datavencCorrigida}\n\nBasta clicar aqui em baixo em código de barras para copiar, apos isto basta realizar o pagamento em seu banco!`,
                                contact
                              )
                            };
                            await sleep(2000);
                            await sendBaileysSocketMessage(
                              wbot,
                              ticketJid,
                              bodyBoleto
                            );
                            const bodyInner44 = {
                              text: formatBody(
                                `Este é o *Codigo de Barras*`,
                                contact
                              )
                            };
                            await sleep(2000);
                            await sendBaileysSocketMessage(
                              wbot,
                              ticketJid,
                              bodyInner44
                            );
                            await sleep(2000);
                            const body_linha_digitavel = {
                              text: formatBody(`${linha_digitavel}`, contact)
                            };
                            await sendBaileysSocketMessage(
                              wbot,
                              ticketJid,
                              body_linha_digitavel
                            );
                            ///VE SE ESTA BLOQUEADO PARA LIBERAR!
                            var optionscontrato = {
                              method: "POST",
                              url: `${urlixc}/webservice/v1/cliente_contrato`,
                              headers: {
                                ixcsoft: "listar",
                                Authorization: `Basic ${ixckeybase64}`
                              },
                              data: {
                                qtype: "cliente_contrato.id_cliente",
                                query: id,
                                oper: "=",
                                page: "1",
                                rp: "1",
                                sortname: "cliente_contrato.id",
                                sortorder: "asc"
                              }
                            };
                            axios
                              .request(optionscontrato as any)
                              .then(async function (responseInner45) {
                                let status_internet;
                                let id_contrato;
                                status_internet =
                                  responseInner45.data?.registros[0]
                                    ?.status_internet;
                                id_contrato =
                                  responseInner45.data?.registros[0]?.id;
                                if (status_internet !== "A") {
                                  const bodyPdf = {
                                    text: formatBody(
                                      `*${nome}* vi tambem que a sua conexão esta bloqueada! Vou desbloquear para você.`,
                                      contact
                                    )
                                  };
                                  await sleep(2000);
                                  await sendBaileysSocketMessage(
                                    wbot,
                                    ticketJid,
                                    bodyPdf
                                  );
                                  const bodyqrcode = {
                                    text: formatBody(
                                      `Estou liberando seu acesso. Por favor aguarde!`,
                                      contact
                                    )
                                  };
                                  await sleep(2000);
                                  await sendBaileysSocketMessage(
                                    wbot,
                                    ticketJid,
                                    bodyqrcode
                                  );
                                  //REALIZANDO O DESBLOQUEIO
                                  var optionsdesbloqeuio = {
                                    method: "POST",
                                    url: `${urlixc}/webservice/v1/desbloqueio_confianca`,
                                    headers: {
                                      Authorization: `Basic ${ixckeybase64}`
                                    },
                                    data: { id: id_contrato }
                                  };

                                  axios
                                    .request(optionsdesbloqeuio as any)
                                    .then(async function (responseInner46) {
                                      let tipoInner1;
                                      let mensagem;
                                      tipoInner1 = responseInner46.data?.tipo;
                                      mensagem = responseInner46.data?.mensagem;
                                      if (tipoInner1 === "sucesso") {
                                        //DESCONECTANDO O CLIENTE PARA VOLTAR O ACESSO
                                        var optionsRadius = {
                                          method: "GET",
                                          url: `${urlixc}/webservice/v1/radusuarios`,
                                          headers: {
                                            ixcsoft: "listar",
                                            Authorization: `Basic ${ixckeybase64}`
                                          },
                                          data: {
                                            qtype: "radusuarios.id_cliente",
                                            query: id,
                                            oper: "=",
                                            page: "1",
                                            rp: "1",
                                            sortname: "radusuarios.id",
                                            sortorder: "asc"
                                          }
                                        };

                                        axios
                                          .request(optionsRadius as any)
                                          .then(async function (
                                            responseInner2
                                          ) {
                                            let tipoInner3;
                                            tipoInner3 =
                                              responseInner2.data?.type;
                                            const body_mensagem = {
                                              text: formatBody(
                                                `${mensagem}`,
                                                contact
                                              )
                                            };
                                            if (tipoInner3 === "success") {
                                              await sleep(2000);
                                              await sendBaileysSocketMessage(
                                                wbot,
                                                ticketJid,
                                                body_mensagem
                                              );
                                              const bodyPdfInner4 = {
                                                text: formatBody(
                                                  `Fiz os procedimentos de liberação! Agora aguarde até 5 minutos e veja se sua conexão irá retornar! .\n\nCaso não tenha voltado, retorne o contato e fale com um atendente!`,
                                                  contact
                                                )
                                              };
                                              await sleep(2000);
                                              await sendBaileysSocketMessage(
                                                wbot,
                                                ticketJid,
                                                bodyPdfInner4
                                              );
                                              const bodyfinaliza = {
                                                text: formatBody(
                                                  `Estamos finalizando esta conversa! Caso precise entre em contato conosco!`,
                                                  contact
                                                )
                                              };
                                              await sleep(2000);
                                              await sendBaileysSocketMessage(
                                                wbot,
                                                ticketJid,
                                                bodyfinaliza
                                              );
                                              await UpdateTicketService({
                                                ticketData: {
                                                  status: "closed"
                                                },
                                                ticketId: ticket.id,
                                                companyId: ticket.companyId
                                              });
                                            } else {
                                              await sleep(2000);
                                              await sendBaileysSocketMessage(
                                                wbot,
                                                ticketJid,
                                                body_mensagem
                                              );
                                              const bodyPdfInner5 = {
                                                text: formatBody(
                                                  `Vou precisar que você *retire* seu equipamento da tomada.\n\n*OBS: Somente retire da tomada.* \nAguarde 1 minuto e ligue novamente!`,
                                                  contact
                                                )
                                              };
                                              await sleep(2000);
                                              await sendBaileysSocketMessage(
                                                wbot,
                                                ticketJid,
                                                bodyPdfInner5
                                              );
                                              const bodyqrcodeInner6 = {
                                                text: formatBody(
                                                  `Veja se seu acesso voltou! Caso não tenha voltado retorne o contato e fale com um atendente!`,
                                                  contact
                                                )
                                              };
                                              await sleep(2000);
                                              await sendBaileysSocketMessage(
                                                wbot,
                                                ticketJid,
                                                bodyqrcodeInner6
                                              );
                                              const bodyfinaliza = {
                                                text: formatBody(
                                                  `Estamos finalizando esta conversa! Caso precise entre em contato conosco!`,
                                                  contact
                                                )
                                              };
                                              await sleep(2000);
                                              await sendBaileysSocketMessage(
                                                wbot,
                                                ticketJid,
                                                bodyfinaliza
                                              );
                                              await UpdateTicketService({
                                                ticketData: {
                                                  status: "closed"
                                                },
                                                ticketId: ticket.id,
                                                companyId: ticket.companyId
                                              });
                                            }
                                          })
                                          .catch(function (error) {
                                            console.error(error);
                                          });
                                        //FIM DA DESCONEXÃO
                                      } else {
                                        const bodyerro = {
                                          text: formatBody(
                                            `Ops! Ocorreu um erro e nao consegui desbloquear! Digite *#* e fale com um atendente!`,
                                            contact
                                          )
                                        };
                                        await sleep(2000);
                                        await sendBaileysSocketMessage(
                                          wbot,
                                          ticketJid,
                                          bodyerro
                                        );
                                      }
                                    })
                                    .catch(async function (_errorUnused7) {
                                      const bodyerro = {
                                        text: formatBody(
                                          `Ops! Ocorreu um erro digite *#* e fale com um atendente!`,
                                          contact
                                        )
                                      };
                                      await sleep(2000);
                                      await sendBaileysSocketMessage(
                                        wbot,
                                        ticketJid,
                                        bodyerro
                                      );
                                    });
                                } else {
                                  const bodyfinaliza = {
                                    text: formatBody(
                                      `Estamos finalizando esta conversa! Caso precise entre em contato conosco!`,
                                      contact
                                    )
                                  };
                                  await sleep(2000);
                                  await sendBaileysSocketMessage(
                                    wbot,
                                    ticketJid,
                                    bodyfinaliza
                                  );
                                  await UpdateTicketService({
                                    ticketData: { status: "closed" },
                                    ticketId: ticket.id,
                                    companyId: ticket.companyId
                                  });
                                }

                                //
                              })
                              .catch(async function (_errorUnused8) {
                                const bodyerro = {
                                  text: formatBody(
                                    `Ops! Ocorreu um erro digite *#* e fale com um atendente!`,
                                    contact
                                  )
                                };
                                await sleep(2000);
                                await sendBaileysSocketMessage(
                                  wbot,
                                  ticketJid,
                                  bodyerro
                                );
                              });
                            ///VE SE ESTA BLOQUEADO PARA LIBERAR!
                          }
                        })
                        .catch(function (error) {
                          console.error(error);
                        });
                      //FIM DO PÌX
                    })
                    .catch(function (error) {
                      console.error(error);
                    });
                }
              })
              .catch(async function (_errorUnused9) {
                const bodyInner10 = {
                  text: formatBody(
                    `*Opss!!!!*\nOcorreu um erro! Digite *#* e fale com um *Atendente*!`,
                    contact
                  )
                };
                await sleep(2000);
                await sendBaileysSocketMessage(
                  wbot,
                  ticketJid,
                  bodyInner10
                );
              });
          } else {
            const body = {
              text: formatBody(
                `Este CPF/CNPJ não é válido!\n\nPor favor tente novamente!\nOu digite *#* para voltar ao *Menu Anterior*`,
                contact
              )
            };
            await sleep(2000);
            await sendBaileysSocketMessage(
              wbot,
              ticketJid,
              body
            );
          }
        }
      }
    }
  }

  if (
    filaescolhida === "Religue de Confiança" ||
    filaescolhida === "Liberação em Confiança"
  ) {
    let cpfcnpj;
    cpfcnpj = getBodyMessage(msg);
    cpfcnpj = cpfcnpj.replace(/\./g, "");
    cpfcnpj = cpfcnpj.replace("-", "");
    cpfcnpj = cpfcnpj.replace("/", "");
    cpfcnpj = cpfcnpj.replace(" ", "");
    cpfcnpj = cpfcnpj.replace(",", "");

    await Setting.findOne({
      where: {
        key: "asaas",
        companyId
      }
    });
    const ixcapikey = await Setting.findOne({
      where: {
        key: "tokenixc",
        companyId
      }
    });
    const urlixcdb = await Setting.findOne({
      where: {
        key: "ipixc",
        companyId
      }
    });
    await Setting.findOne({
      where: {
        key: "ipmkauth",
        companyId
      }
    });
    await Setting.findOne({
      where: {
        key: "clientidmkauth",
        companyId
      }
    });
    await Setting.findOne({
      where: {
        key: "clientsecretmkauth",
        companyId
      }
    });

    //VARS
    const ixckeybase64 = btoa(ixcapikey.value);
    const urlixc = urlixcdb.value;

    let numberCPFCNPJ = cpfcnpj;

    if (ixcapikey.value !== "" && urlixcdb.value !== "") {
      if (isNumeric(numberCPFCNPJ) === true) {
        if (cpfcnpj.length > 2) {
          const isCPFCNPJ = validaCpfCnpj(numberCPFCNPJ);
          if (isCPFCNPJ) {
            if (numberCPFCNPJ.length <= 11) {
              numberCPFCNPJ = numberCPFCNPJ.replace(/(\d{3})(\d)/, "$1.$2");
              numberCPFCNPJ = numberCPFCNPJ.replace(/(\d{3})(\d)/, "$1.$2");
              numberCPFCNPJ = numberCPFCNPJ.replace(
                /(\d{3})(\d{1,2})$/,
                "$1-$2"
              );
            } else {
              numberCPFCNPJ = numberCPFCNPJ.replace(/^(\d{2})(\d)/, "$1.$2");
              numberCPFCNPJ = numberCPFCNPJ.replace(
                /^(\d{2})\.(\d{3})(\d)/,
                "$1.$2.$3"
              );
              numberCPFCNPJ = numberCPFCNPJ.replace(/\.(\d{3})(\d)/, ".$1/$2");
              numberCPFCNPJ = numberCPFCNPJ.replace(/(\d{4})(\d)/, "$1-$2");
            }
            //const token = await CheckSettingsHelper("OBTEM O TOKEN DO BANCO (dei insert na tabela settings)")
            const body = {
              text: formatBody(
                `Aguarde! Estamos consultando na base de dados!`,
                contact
              )
            };
            try {
              await sleep(2000);
              await sendBaileysSocketMessage(
                wbot,
                ticketJid,
                body
              );
            } catch (error) {}
            var options = {
              method: "GET",
              url: `${urlixc}/webservice/v1/cliente`,
              headers: {
                ixcsoft: "listar",
                Authorization: `Basic ${ixckeybase64}`
              },
              data: {
                qtype: "cliente.cnpj_cpf",
                query: numberCPFCNPJ,
                oper: "=",
                page: "1",
                rp: "1",
                sortname: "cliente.cnpj_cpf",
                sortorder: "asc"
              }
            };

            axios
              .request(options as any)
              .then(async function (response) {
                if (response.data.type === "error") {
                  const bodyInner11 = {
                    text: formatBody(
                      `*Opss!!!!*\nOcorreu um erro! Digite *#* e fale com um *Atendente*!`,
                      contact
                    )
                  };
                  await sleep(2000);
                  await sendBaileysSocketMessage(
                    wbot,
                    ticketJid,
                    bodyInner11
                  );
                }
                if (response.data.total === 0) {
                  const bodyInner12 = {
                    text: formatBody(
                      `Cadastro não localizado! *CPF/CNPJ* incorreto ou inválido. Tenta novamente!`,
                      contact
                    )
                  };
                  try {
                    await sleep(2000);
                    await sendBaileysSocketMessage(
                      wbot,
                      ticketJid,
                      bodyInner12
                    );
                  } catch (error) {}
                } else {
                  let nome;
                  let id;

                  nome = response.data?.registros[0]?.razao;
                  id = response.data?.registros[0]?.id;

                  const bodyInner13 = {
                    text: formatBody(
                      `Localizei seu Cadastro! \n*${nome}* só mais um instante por favor!`,
                      contact
                    )
                  };
                  await sleep(2000);
                  await sendBaileysSocketMessage(
                    wbot,
                    ticketJid,
                    bodyInner13
                  );
                  ///VE SE ESTA BLOQUEADO PARA LIBERAR!
                  var optionscontrato = {
                    method: "POST",
                    url: `${urlixc}/webservice/v1/cliente_contrato`,
                    headers: {
                      ixcsoft: "listar",
                      Authorization: `Basic ${ixckeybase64}`
                    },
                    data: {
                      qtype: "cliente_contrato.id_cliente",
                      query: id,
                      oper: "=",
                      page: "1",
                      rp: "1",
                      sortname: "cliente_contrato.id",
                      sortorder: "asc"
                    }
                  };
                  axios
                    .request(optionscontrato as any)
                    .then(async function (responseInner14) {
                      let status_internet;
                      let id_contrato;
                      status_internet =
                        responseInner14.data?.registros[0]?.status_internet;
                      id_contrato = responseInner14.data?.registros[0]?.id;
                      if (status_internet !== "A") {
                        const bodyPdf = {
                          text: formatBody(
                            `*${nome}*  a sua conexão esta bloqueada! Vou desbloquear para você.`,
                            contact
                          )
                        };
                        await sleep(2000);
                        await sendBaileysSocketMessage(
                          wbot,
                          ticketJid,
                          bodyPdf
                        );
                        const bodyqrcode = {
                          text: formatBody(
                            `Estou liberando seu acesso. Por favor aguarde!`,
                            contact
                          )
                        };
                        await sleep(2000);
                        await sendBaileysSocketMessage(
                          wbot,
                          ticketJid,
                          bodyqrcode
                        );
                        //REALIZANDO O DESBLOQUEIO
                        var optionsdesbloqeuio = {
                          method: "POST",
                          url: `${urlixc}/webservice/v1/desbloqueio_confianca`,
                          headers: {
                            Authorization: `Basic ${ixckeybase64}`
                          },
                          data: { id: id_contrato }
                        };

                        axios
                          .request(optionsdesbloqeuio as any)
                          .then(async function (responseInner15) {
                            let tipo;
                            let mensagem;
                            tipo = responseInner15.data?.tipo;
                            mensagem = responseInner15.data?.mensagem;
                            const body_mensagem = {
                              text: formatBody(`${mensagem}`, contact)
                            };
                            if (tipo === "sucesso") {
                              //DESCONECTANDO O CLIENTE PARA VOLTAR O ACESSO
                              var optionsRadius = {
                                method: "GET",
                                url: `${urlixc}/webservice/v1/radusuarios`,
                                headers: {
                                  ixcsoft: "listar",
                                  Authorization: `Basic ${ixckeybase64}`
                                },
                                data: {
                                  qtype: "radusuarios.id_cliente",
                                  query: id,
                                  oper: "=",
                                  page: "1",
                                  rp: "1",
                                  sortname: "radusuarios.id",
                                  sortorder: "asc"
                                }
                              };

                              axios
                                .request(optionsRadius as any)
                                .then(async function (responseInner16) {
                                  let tipoInner17;
                                  tipoInner17 = responseInner16.data?.type;

                                  if (tipoInner17 === "success") {
                                    await sleep(2000);
                                    await sendBaileysSocketMessage(
                                      wbot,
                                      ticketJid,
                                      body_mensagem
                                    );
                                    const bodyPdfInner18 = {
                                      text: formatBody(
                                        `Fiz os procedimentos de liberação! Agora aguarde até 5 minutos e veja se sua conexão irá retornar! .\n\nCaso não tenha voltado, retorne o contato e fale com um atendente!`,
                                        contact
                                      )
                                    };
                                    await sleep(2000);
                                    await sendBaileysSocketMessage(
                                      wbot,
                                      ticketJid,
                                      bodyPdfInner18
                                    );
                                    const bodyfinaliza = {
                                      text: formatBody(
                                        `Estamos finalizando esta conversa! Caso precise entre em contato conosco!`,
                                        contact
                                      )
                                    };
                                    await sleep(2000);
                                    await sendBaileysSocketMessage(
                                      wbot,
                                      ticketJid,
                                      bodyfinaliza
                                    );
                                    await UpdateTicketService({
                                      ticketData: { status: "closed" },
                                      ticketId: ticket.id,
                                      companyId: ticket.companyId
                                    });
                                  } else {
                                    await sleep(2000);
                                    await sendBaileysSocketMessage(
                                      wbot,
                                      ticketJid,
                                      body_mensagem
                                    );
                                    const bodyPdfInner19 = {
                                      text: formatBody(
                                        `Vou precisar que você *retire* seu equipamento da tomada.\n\n*OBS: Somente retire da tomada.* \nAguarde 1 minuto e ligue novamente!`,
                                        contact
                                      )
                                    };
                                    await sleep(2000);
                                    await sendBaileysSocketMessage(
                                      wbot,
                                      ticketJid,
                                      bodyPdfInner19
                                    );
                                    const bodyqrcodeInner20 = {
                                      text: formatBody(
                                        `Veja se seu acesso voltou! Caso não tenha voltado retorne o contato e fale com um atendente!`,
                                        contact
                                      )
                                    };
                                    await sleep(2000);
                                    await sendBaileysSocketMessage(
                                      wbot,
                                      ticketJid,
                                      bodyqrcodeInner20
                                    );
                                    const bodyfinaliza = {
                                      text: formatBody(
                                        `Estamos finalizando esta conversa! Caso precise entre em contato conosco!`,
                                        contact
                                      )
                                    };
                                    await sleep(2000);
                                    await sendBaileysSocketMessage(
                                      wbot,
                                      ticketJid,
                                      bodyfinaliza
                                    );
                                    await UpdateTicketService({
                                      ticketData: { status: "closed" },
                                      ticketId: ticket.id,
                                      companyId: ticket.companyId
                                    });
                                  }
                                })
                                .catch(function (error) {
                                  console.error(error);
                                });
                              //FIM DA DESCONEXÃO
                            } else {
                              const bodyerro = {
                                text: formatBody(
                                  `Ops! Ocorreu um erro e nao consegui desbloquear!`,
                                  contact
                                )
                              };
                              await sleep(2000);
                              await sendBaileysSocketMessage(
                                wbot,
                                ticketJid,
                                bodyerro
                              );
                              await sleep(2000);
                              await sendBaileysSocketMessage(
                                wbot,
                                ticketJid,
                                body_mensagem
                              );
                              const bodyerroatendente = {
                                text: formatBody(
                                  `Digite *#* e fale com um atendente!`,
                                  contact
                                )
                              };
                              await sleep(2000);
                              await sendBaileysSocketMessage(
                                wbot,
                                ticketJid,
                                bodyerroatendente
                              );
                            } /* else {
                                 const bodyerro = {
                  text: formatBody(`Ops! Ocorreu um erro e nao consegui desbloquear! Digite *#* e fale com um atendente!`
                                 await sleep(2000)
                                 await sendBaileysSocketMessage(wbot, ticketJid,bodyerro);
                             } */
                          })
                          .catch(async function (_errorUnused21) {
                            const bodyerro = {
                              text: formatBody(
                                `Ops! Ocorreu um erro digite *#* e fale com um atendente!`,
                                contact
                              )
                            };
                            await sleep(2000);
                            await sendBaileysSocketMessage(
                              wbot,
                              ticketJid,
                              bodyerro
                            );
                          });
                      } else {
                        const bodysembloqueio = {
                          text: formatBody(
                            `Sua Conexão não está bloqueada! Caso esteja com dificuldades de navegação, retorne o contato e fale com um atendente!`,
                            contact
                          )
                        };
                        await sleep(2000);
                        await sendBaileysSocketMessage(
                          wbot,
                          ticketJid,
                          bodysembloqueio
                        );
                        const bodyfinaliza = {
                          text: formatBody(
                            `Estamos finalizando esta conversa! Caso precise entre em contato conosco!`,
                            contact
                          )
                        };
                        await sleep(2000);
                        await sendBaileysSocketMessage(
                          wbot,
                          ticketJid,
                          bodyfinaliza
                        );
                        await UpdateTicketService({
                          ticketData: { status: "closed" },
                          ticketId: ticket.id,
                          companyId: ticket.companyId
                        });
                      }

                      //
                    })
                    .catch(async function (_errorUnused22) {
                      const bodyerro = {
                        text: formatBody(
                          `Ops! Ocorreu um erro digite *#* e fale com um atendente!`,
                          contact
                        )
                      };
                      await sleep(2000);
                      await sendBaileysSocketMessage(
                        wbot,
                        ticketJid,
                        bodyerro
                      );
                    });
                }
              })
              .catch(async function (_errorUnused23) {
                const bodyInner24 = {
                  text: formatBody(
                    `*Opss!!!!*\nOcorreu um erro! Digite *#* e fale com um *Atendente*!`,
                    contact
                  )
                };
                await sleep(2000);
                await sendBaileysSocketMessage(
                  wbot,
                  ticketJid,
                  bodyInner24
                );
              });
          } else {
            const body = {
              text: formatBody(
                `Este CPF/CNPJ não é válido!\n\nPor favor tente novamente!\nOu digite *#* para voltar ao *Menu Anterior*`,
                contact
              )
            };
            await sleep(2000);
            await sendBaileysSocketMessage(
              wbot,
              ticketJid,
              body
            );
          }
        }
      }
    }
  }
};
