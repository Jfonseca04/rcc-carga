import { PublicClientApplication, InteractionRequiredAuthError, type AccountInfo } from "@azure/msal-browser";
import { CONFIG } from "./config";

export const msal = new PublicClientApplication({
  auth: {
    clientId: CONFIG.azure.clientId,
    authority: `https://login.microsoftonline.com/${CONFIG.azure.tenantId}`,
    redirectUri: location.origin + location.pathname
  },
  cache: { cacheLocation: "localStorage" } // la sesión sobrevive sin señal y al cerrar la app
});

let listo: Promise<void> | null = null;
export function iniciarAuth() {
  if (!listo) {
    listo = msal.initialize().then(async () => {
      const r = await msal.handleRedirectPromise();
      if (r?.account) msal.setActiveAccount(r.account);
      else if (!msal.getActiveAccount() && msal.getAllAccounts()[0]) msal.setActiveAccount(msal.getAllAccounts()[0]);
    });
  }
  return listo;
}

export function cuenta(): AccountInfo | null {
  return msal.getActiveAccount();
}

export async function entrar() {
  await iniciarAuth();
  await msal.loginRedirect({ scopes: CONFIG.scopes });
}

export async function salir() {
  await iniciarAuth();
  await msal.logoutRedirect({ account: cuenta() || undefined });
}

/** Token para Graph. Sin señal no se puede renovar: la carga sigue y se sincroniza después. */
export async function token(): Promise<string> {
  await iniciarAuth();
  const account = cuenta();
  if (!account) throw new Error("Iniciá sesión con tu cuenta de Microsoft.");
  try {
    return (await msal.acquireTokenSilent({ scopes: CONFIG.scopes, account })).accessToken;
  } catch (e) {
    if (e instanceof InteractionRequiredAuthError) {
      await msal.acquireTokenRedirect({ scopes: CONFIG.scopes, account });
    }
    throw e;
  }
}
