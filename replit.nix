{pkgs}: {
  deps = [
    pkgs.postgresql
    pkgs.ffmpeg
    pkgs.redis
    pkgs.unzip
  ];
}
