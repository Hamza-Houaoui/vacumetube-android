# Add project specific ProGuard rules here.
# Keep the JS bridge interface reachable from the WebView.
-keepclassmembers class rocks.shy.vacuumtube.VtBridge {
    public *;
}