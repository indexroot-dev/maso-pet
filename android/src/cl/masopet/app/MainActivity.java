package cl.masopet.app;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.CookieManager;
import android.webkit.GeolocationPermissions;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * App de Android de MasoPet: muestra la aplicación web en pantalla completa.
 * La dirección del servidor se define al compilar (ver android/construir-apk.ps1).
 */
public class MainActivity extends Activity {

    private static final String URL_APP = "__URL_APP__";
    private static final int PEDIR_UBICACION = 1;
    private static final int ELEGIR_ARCHIVO = 2;

    private WebView web;
    private ValueCallback<Uri[]> callbackArchivo;
    private GeolocationPermissions.Callback callbackUbicacion;
    private String origenUbicacion;

    @Override
    protected void onCreate(Bundle estadoGuardado) {
        super.onCreate(estadoGuardado);
        getWindow().setStatusBarColor(Color.parseColor("#0F766E"));

        web = new WebView(this);
        setContentView(web);

        WebSettings ajustes = web.getSettings();
        ajustes.setJavaScriptEnabled(true);
        ajustes.setDomStorageEnabled(true);
        ajustes.setGeolocationEnabled(true);
        ajustes.setAllowFileAccess(false);
        ajustes.setAllowContentAccess(true);
        ajustes.setUserAgentString(ajustes.getUserAgentString() + " MasoPetAndroid/1.0");
        CookieManager.getInstance().setAcceptCookie(true);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView vista, WebResourceRequest pedido) {
                Uri destino = pedido.getUrl();
                if (esDeLaApp(destino)) return false;
                // Teléfono, WhatsApp, Google Maps, correos, etc. se abren en su app
                abrirFuera(destino);
                return true;
            }

            @Override
            public void onReceivedError(WebView vista, WebResourceRequest pedido, WebResourceError error) {
                if (pedido.isForMainFrame()) mostrarSinConexion();
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origen, GeolocationPermissions.Callback callback) {
                if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                    callback.invoke(origen, true, false);
                } else {
                    callbackUbicacion = callback;
                    origenUbicacion = origen;
                    requestPermissions(new String[] {
                        Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION
                    }, PEDIR_UBICACION);
                }
            }

            // Subir fotos (mascotas, adopciones, perfil de cuidador)
            @Override
            public boolean onShowFileChooser(WebView vista, ValueCallback<Uri[]> callback, FileChooserParams parametros) {
                if (callbackArchivo != null) callbackArchivo.onReceiveValue(null);
                callbackArchivo = callback;
                try {
                    startActivityForResult(parametros.createIntent(), ELEGIR_ARCHIVO);
                } catch (Exception e) {
                    callbackArchivo = null;
                    return false;
                }
                return true;
            }
        });

        if (estadoGuardado != null) web.restoreState(estadoGuardado);
        else web.loadUrl(URL_APP);
    }

    private boolean esDeLaApp(Uri destino) {
        Uri app = Uri.parse(URL_APP);
        String esquema = destino.getScheme();
        return ("http".equals(esquema) || "https".equals(esquema))
            && app.getHost() != null && app.getHost().equalsIgnoreCase(destino.getHost())
            && app.getPort() == destino.getPort();
    }

    private void abrirFuera(Uri destino) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, destino));
        } catch (Exception ignorado) {
            // No hay ninguna app que pueda abrir este enlace
        }
    }

    private void mostrarSinConexion() {
        String html = "<!doctype html><html lang='es'><head><meta name='viewport' content='width=device-width, initial-scale=1'>"
            + "<style>body{font-family:sans-serif;background:#f6f8f7;color:#1f2933;display:flex;align-items:center;justify-content:center;"
            + "min-height:90vh;margin:0;padding:24px;text-align:center}a{display:inline-block;margin-top:16px;background:#0f766e;color:#fff;"
            + "padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:600}p{color:#64748b}</style></head><body><div>"
            + "<div style='font-size:56px'>🐾</div><h2>No pudimos conectar con MasoPet</h2>"
            + "<p>Revisa tu conexión a internet. Si usas la versión local, el celular debe estar en la misma red WiFi que el computador "
            + "y el servidor debe estar encendido.</p><a href='" + URL_APP + "'>Reintentar</a></div></body></html>";
        web.loadDataWithBaseURL(null, html, "text/html", "utf-8", null);
    }

    @Override
    protected void onActivityResult(int codigo, int resultado, Intent datos) {
        if (codigo == ELEGIR_ARCHIVO && callbackArchivo != null) {
            callbackArchivo.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultado, datos));
            callbackArchivo = null;
            return;
        }
        super.onActivityResult(codigo, resultado, datos);
    }

    @Override
    public void onRequestPermissionsResult(int codigo, String[] permisos, int[] resultados) {
        if (codigo == PEDIR_UBICACION && callbackUbicacion != null) {
            boolean concedido = resultados.length > 0 && resultados[0] == PackageManager.PERMISSION_GRANTED;
            callbackUbicacion.invoke(origenUbicacion, concedido, false);
            callbackUbicacion = null;
        }
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onSaveInstanceState(Bundle estado) {
        super.onSaveInstanceState(estado);
        web.saveState(estado);
    }

    @Override
    protected void onPause() {
        super.onPause();
        CookieManager.getInstance().flush();
    }
}
