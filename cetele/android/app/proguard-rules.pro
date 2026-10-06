# Release builds drop android.util.Log calls entirely (security checklist item 14).
-keepattributes Signature,InnerClasses,EnclosingMethod,RuntimeVisibleAnnotations,AnnotationDefault
-keepclassmembers class ** implements kotlinx.serialization.KSerializer { *; }
-keepclassmembers class ** {
    *** Companion;
}
-keepclasseswithmembers class ** {
    kotlinx.serialization.KSerializer serializer(...);
}
-keep class net.zetetic.database.sqlcipher.** { *; }
-keepclassmembers,includedescriptorclasses class * {
    native <methods>;
}
-keep class org.bouncycastle.crypto.generators.Argon2BytesGenerator { *; }
-keep class org.bouncycastle.crypto.params.Argon2Parameters** { *; }
-keep class * extends androidx.room.RoomDatabase { *; }
-keep class **_Impl extends androidx.room.RoomDatabase { *; }
-keepnames class io.ktor.** { *; }
-assumenosideeffects class android.util.Log {
    public static int v(...);
    public static int d(...);
    public static int i(...);
    public static int w(...);
    public static int e(...);
    public static int wtf(...);
    public static boolean isLoggable(java.lang.String, int);
}
