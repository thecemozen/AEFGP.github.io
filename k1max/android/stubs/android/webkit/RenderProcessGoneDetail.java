package android.webkit;
// Yalnızca derleme için (API 26 sınıfı; android-23 jar'ında yok). DEX'e girmez, çalışma anında sistemdeki gerçek sınıf kullanılır.
public abstract class RenderProcessGoneDetail {
    public abstract boolean didCrash();
    public abstract int rendererPriorityAtExit();
}
