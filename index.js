const {
  default: makeWASocket,
  DisconnectReason,
  fetchLatestBaileysVersion,
  isJidBroadcast,
  makeInMemoryStore,
  useMultiFileAuthState,
} = require("@whiskeysockets/baileys");
const axios = require('axios');
const streamifier = require('streamifier');
const { pipeline } = require('stream/promises');

const log = (pino = require("pino"));
const { session } = { session: "baileys_auth_info" };
const { Boom } = require("@hapi/boom");
const path = require("path");
const fs = require("fs");
const http = require("http");
const https = require("https");
const express = require("express");
const fileUpload = require("express-fileupload");
const cors = require("cors");
const bodyParser = require("body-parser");
const app = require("express")();
// enable files upload
app.use(
  fileUpload({
    createParentPath: true,
  })
);

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
const server = require("http").createServer(app);
const io = require("socket.io")(server);
const port = process.env.PORT || 8000;
const qrcode = require("qrcode");

app.use("/assets", express.static(__dirname + "/client/assets"));

app.get("/", (req, res) => {
  res.sendFile("./client/server.html", {
    root: __dirname,
  });
});

const store = makeInMemoryStore({
  logger: pino().child({ level: "silent", stream: "store" }),
});

let sock;
let qr;
let soket;

//Inicialización del servicio
async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState("ola-message-session");
  let { version } = await fetchLatestBaileysVersion();
  sock = makeWASocket({
    printQRInTerminal: true,
    auth: state,
    logger: log({ level: "silent" }),
    version,
    shouldIgnoreJid: (jid) => isJidBroadcast(jid),
  });
  store.bind(sock.ev);
  sock.multi = true;
  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === "close") {
      let reason = new Boom(lastDisconnect.error).output.statusCode;
      if (reason === DisconnectReason.badSession) {
        console.log(
          `Bad Session File, Please Delete ${session} and Scan Again`
        );
        sock.logout();
      } else if (reason === DisconnectReason.connectionClosed) {
        console.log("Connection closed, reconnecting....");
        connectToWhatsApp();
      } else if (reason === DisconnectReason.connectionLost) {
        console.log("Connection Lost from Server, reconnecting...");
        connectToWhatsApp();
      } else if (reason === DisconnectReason.connectionReplaced) {
        console.log(
          "Connection Replaced, Another New Session Opened, Please Close Current Session First"
        );
        sock.logout();
      } else if (reason === DisconnectReason.loggedOut) {
        console.log(
          `Device Logged Out, Please Delete ${session} and Scan Again.`
        );
        sock.logout();
      } else if (reason === DisconnectReason.restartRequired) {
        console.log("Restart Required, Restarting...");
        connectToWhatsApp();
      } else if (reason === DisconnectReason.timedOut) {
        console.log("Connection TimedOut, Reconnecting...");
        connectToWhatsApp();
      } else {
        sock.end(`Unknown DisconnectReason: ${reason}|${lastDisconnect.error}`);
      }
    } else if (connection === "open") {
      console.log("opened connection");
      return;
    }
    if (update.qr) {
      qr = update.qr;
      updateQR("qr");
    } else if ((qr = undefined)) {
      updateQR("loading");
    } else {
      if (update.connection === "open") {
        updateQR("qrscanned");
        return;
      }
    }
  });
  sock.ev.on("creds.update", saveCreds);
}

io.on("connection", async (socket) => {
  soket = socket;
  if (isConnected) {
    updateQR("connected");
  } else if (qr) {
    updateQR("qr");
  }
});

// functions
const isConnected = () => {
  return sock.user;
};

const updateQR = (data) => {
  switch (data) {
    case "qr":
      qrcode.toDataURL(qr, (err, url) => {
        soket?.emit("qr", url);
        soket?.emit("log", "QR Code received, please scan!");
      });
      break;
    case "connected":
      soket?.emit("qrstatus", "./assets/check.svg");
      soket?.emit("log", "WhatsApp terhubung!");
      break;
    case "qrscanned":
      soket?.emit("qrstatus", "./assets/check.svg");
      soket?.emit("log", "QR Code Telah discan!");
      break;
    case "loading":
      soket?.emit("qrstatus", "./assets/loader.gif");
      soket?.emit("log", "Registering QR Code , please wait!");
      break;
    default:
      break;
  }
};

const sendMessage = async (message, number) => {
  let numberWA;
  try {
    numberWA = "57" + number + "@s.whatsapp.net";
    if (isConnected) {
      const exists = await sock.onWhatsApp(numberWA);
      if (exists?.jid || (exists && exists[0]?.jid)) {
        sock
          .sendMessage(exists.jid || exists[0].jid, { text: message })
          .then()
          .catch((err) => {
            console.log(`ERROR: 500, MSG: ${err}`);
          });
      } else {
        console.log(
          `ERROR: 500, MSG: El número ${number} no aparece en la lista.`
        );
      }
    } else {
      console.log("ERROR: 500, MSG: WhatsApp aún no está conectado.");
    }
  } catch (err) {
    res.status(500).send(err);
  }
};

const procesarCliente = async (cliente, msg) => {
  // Aquí procesamos cada cliente
  const mensaje = msg
    .replace("{nombre}", cliente.nombre)
    .replace("{apellido}", cliente.apellido)
    .replace("{ubicacion}", cliente.ubicacion)
    .replace("{cedula}", cliente.cedula)
    .replace("{telefono}", cliente.telefono)
    .replace("{correo}", cliente.correo);

  await sendMessage(mensaje, cliente.telefono);

  // Esperar 10 segundos después de cada cliente
  await new Promise((resolve) => setTimeout(resolve, 10 * 1000));
};

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = Math.random() * 16 | 0,
      v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}


const procesarClienteImagen = async (cliente, message) => {
  const numberValidate = "57" + cliente.cel + "@s.whatsapp.net";
  if (message) {
    for (const sender of message) {
      await sock.sendMessage(numberValidate, {
        image: { url: sender.url },
        caption: sender.msg
      });
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 10 * 1000));
}

const procesarGrupoClientes = async (grupoClientes, msg) => {
  for (let cliente of grupoClientes) {
    await procesarCliente(cliente, msg);
  }
};
const procesarGrupoClientesImg = async (grupoClientes, msg) => {

  for (let cliente of grupoClientes) {
    await procesarClienteImagen(cliente, msg);
  }
};

const manejarClientes = async (clientes, msg, typeConnect) => {
  // Dividir clientes en grupos de 500
  let gruposClientes = [];
  for (let i = 0; i < clientes.length; i += 500) {
    gruposClientes.push(clientes.slice(i, i + 500));
  }

  for (let i = 0; i < gruposClientes.length; i++) {
    if (typeConnect == "img") {
      await procesarGrupoClientesImg(gruposClientes[i], msg)
    } else {
      await procesarGrupoClientes(gruposClientes[i], msg);
    }

    // Si no es el último grupo, esperar 1.5 horas antes de continuar con el siguiente grupo
    if (i < gruposClientes.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 1.5 * 60 * 60 * 1000));
    }
  }
};

// send text message to wa user
app.post("/api/v2/sendmessage", async ({ body }, res) => {
  const { clientes, message, typeConnect } = body;
  let dataMsg = message;
  if (typeConnect == "img") {
    dataMsg = [{
      url: path.join(__dirname, "./tmp/1.jpg"),
      msg: ""
    }, {
      url: path.join(__dirname, "./tmp/2.jpg"),
      msg: ""
    }]
  }
  manejarClientes(clientes, dataMsg, typeConnect)
    .then(() => {
      console.log("Proceso de clientes completado");
    })
    .catch((err) => {
      console.error("Error al procesar los clientes:", err);
    });

  res.json({ status: "in-progress", message: "El proceso ha comenzado." });
});

connectToWhatsApp().catch((err) => console.log("unexpected error: " + err)); // catch any errors
server.listen(port, () => {
  console.log("Server Berjalan pada Port : " + port);
});
