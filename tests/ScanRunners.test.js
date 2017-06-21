import ScanRunners from 'ScanRunners';
import path from 'path';
import { getBundleType, inferDestinationPath } from 'ScanRunners';

import validators from 'validators';

import fs from 'async-file';

describe('getBundleType', () => {
  describe('when the path is a tv show', () => {
    const show = 'foo';
    const season = '05';
    const path = `/Downloads/${show}.S${season}E07.720p.HDTV.X264-BAR`;

    test('should return "tvShow" as the bundle type', () => {
      const result = getBundleType(path);
      expect(result.type).toBe('tvShow');
    });

    test('should return the show', () => {
      const result = getBundleType(path);
      expect(result.show).toBe(show);
    });

    test('should return the season', () => {
      const result = getBundleType(path);
      expect(result.season).toBe(season);
    });
  });

  describe('when the path is a movie', () => {
    const path = `/Downloads/F-oo.bar.2013.1080p.BluRay.x264-FOO/`;

    test('should return "movie" as the bundle type', () => {
      const result = getBundleType(path);
      expect(result.type).toBe('movie');
    });

    describe('when the name contains Blu-Ray', () => {
      const path = `/Downloads/F-oo.bar.2013.1080p.Blu-Ray.x264-FOO/`;

      test('should return "movie" as the bundle type', () => {
        const result = getBundleType(path);
        expect(result.type).toBe('movie');
      });
    });
  });

  describe('when the path is something else', () => {
    const path = '/Downloads/foo.bar';

    test('should return "unrecognized" as the bundle type', () => {
      const result = getBundleType(path);
      expect(result.type).toBe('unrecognized');
    });
  })
});

describe('inferDestinationPath', () => {
  const shareBasePaths = {
    tvShow: '/Share/tv_shows',
    movie: '/Share/movies'
  }

  describe('when the path is a tv show', () => {
    const shareBasePath = shareBasePaths.tvShow;
    const show = 'foo';
    const season = '05';
    const dirName = `${show}.S${season}E07.720p.HDTV.X264-BAR`;
    const path = `/Downloads/${dirName}/`;

    test('should destination path correctly inferred for tv shows', async () => {
      const destPath = inferDestinationPath(path, shareBasePaths);
      const expected = `${shareBasePath}/${show}/s${season}/${dirName}`;

      expect(destPath).toBe(expected);
    });
  });

  describe('when the path is a movie', () => {
    const shareBasePath = shareBasePaths.movie;
    const dirName = 'F-oo.bar.2013.1080p.BluRay.x264-FOO'
    const path = `/Downloads/${dirName}`;

    test('should destination path correctly inferred for tv shows', async () => {
      const destPath = inferDestinationPath(path, shareBasePaths);
      const expected = `${shareBasePath}/${dirName}`;

      expect(destPath).toBe(expected);
    });
  });

  describe('when the path is something else', () => {
    const path = '/Downloads/foo.bar';

    test('should return null', () => {
      const destPath = inferDestinationPath(path, shareBasePaths);
      expect(destPath).toBeNull();
    })
  });
});

describe('Scan runner', () => {
  const logger = {
    verbose: _ => {},
    info: _ => {},
    warn: _ => {},
    error: _ => {},
  }

  const getScanRunners = (socket, ignoreExcluded = false) => {
    return ScanRunners(
      socket,
      'test-extension',
      () => ({
        validators,
        ignoreExcluded,
      }),

    );
  };

  test('should reject invalid bundles', async () => {
    const scanPath = path.join(__dirname, 'data/Test.Release-TEST');

    const bundle = {
      name: 'Test.Release-TEST',
      target: scanPath,
      type: {
        id: 'directory',
      },
    };

    const socket = {
      post: _ => {},
      logger,
    };

    const reject = jest.fn();
    const accept = jest.fn();

    const runner = getScanRunners(socket);
    const scanner = await runner.onBundleFinished(bundle, accept, reject);

    expect(reject.mock.calls.length).toBe(1);
    expect(accept.mock.calls.length).toBe(0);
    expect(scanner.stats.scannedDirectories).toBe(2);
  });

  test('should reject invalid new share directories', async () => {
    const scanPath = path.join(__dirname, 'data/Test.Release-TEST');

    const hookData = {
      path: scanPath,
      new_parent: false,
    };

    const socket = {
      post: _ => {},
      logger,
    };

    const reject = jest.fn();
    const accept = jest.fn();

    const runner = getScanRunners(socket);
    const scanner = await runner.onShareDirectoryAdded(hookData, accept, reject);

    expect(reject.mock.calls.length).toBe(1);
    expect(accept.mock.calls.length).toBe(0);
    expect(scanner.stats.scannedDirectories).toBe(1); // Not recursive
  });

  test('should ignore excluded files/directories', async () => {
    const scanPath = path.join(__dirname, 'data/Test.Release-TEST');

    const ignoredPathFn = jest.fn();
    const socket = {
      post: (url, data) => {
        // Events
        if (url.startsWith('events')) {
          return {};
        }

        if (url.startsWith('share')) {

          // Share validator
          if (data.path.endsWith('Sample' + path.sep) || data.path.endsWith('forbidden_extra.zip')) {
            ignoredPathFn(url, data);
            throw Error('Ignored');
          }
        }

        return {};
      },
      logger,
    };

    const hookData = {
      path: scanPath,
      new_parent: false,
    };


    const reject = jest.fn();
    const accept = jest.fn();

    const runner = getScanRunners(socket, true);
    const scanner = await runner.onShareDirectoryAdded(hookData, accept, reject);

    expect(reject.mock.calls.length).toBe(0);
    expect(accept.mock.calls.length).toBe(1);
    expect(ignoredPathFn.mock.calls.length).toBe(2);
    expect(scanner.stats.scannedDirectories).toBe(1);
  });

  test('should scan share roots', async () => {
    const scanPath = path.join(__dirname, 'data/Test.Release-TEST');

    const shareRootInfo = {
      id: 1,
      path: scanPath,
    };

    const socket = {
      post: _ => {},
      get: _ => Promise.resolve(shareRootInfo),
      logger,
    };

    const runner = getScanRunners(socket);
    const scanner = await runner.scanShareRoots([ 1 ]);

    expect(scanner.errors.count() > 0).toBe(true);
    expect(scanner.stats.scannedDirectories).toBe(2);
  });

  test('should perform share scan', async () => {
    const sharePaths = [
      {
        name: 'VNAME',
        paths: [ path.join(__dirname, 'data/Test.Release-TEST') ],
      }
    ];

    const socket = {
      post: _ => {},
      get: _ => Promise.resolve(sharePaths),
      logger,
    };

    const runner = getScanRunners(socket);
    const scanner = await runner.scanShare();

    expect(scanner.errors.count() > 0).toBe(true);
  });

  test('should report disk access errors', async () => {
    const sharePaths = [
      {
        name: 'VNAME',
        paths: [ path.join(__dirname, 'nonexistingdirectory') ],
      }
    ];

    const socket = {
      post: _ => {},
      get: _ => Promise.resolve(sharePaths),
      logger,
    };

    const runner = getScanRunners(socket);
    const scanner = await runner.scanShare();

    expect(scanner.errors.count() > 0).toBe(true);
    expect(scanner.errors.format().indexOf('ENOENT')).not.toBe(-1);
  });
});
