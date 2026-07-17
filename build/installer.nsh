!macro customInstall
  ; The encrypted protected-client bundle and verifier remain available to the
  ; launcher but are hidden from normal Explorer views until Hidden items is enabled after installation.
  SetFileAttributes "$INSTDIR\resources\resources\client" HIDDEN
  SetFileAttributes "$INSTDIR\resources\resources\client\megaclient.bundle" HIDDEN
  SetFileAttributes "$INSTDIR\resources\resources\client\launch-verifier.jar" HIDDEN
!macroend
